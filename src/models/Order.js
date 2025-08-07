const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { ValidationError, DatabaseError, NotFoundError } = require('../middleware/errorHandler');
const { ORDER_STATUS, BUSINESS_CONFIG } = require('../utils/constants');

// ============================================
// MODELO ORDER
// ============================================

class Order {

  /**
   * Crea un nuevo pedido desde una conversación
   * @param {Object} orderData - Datos del pedido
   * @returns {Promise<Object>} Pedido creado
   */
  static async create(orderData) {
    const {
      restaurant_id,
      customer_id = null,
      conversation_id = null,
      customer_phone,
      customer_name = null,
      delivery_street,
      delivery_number,
      delivery_neighborhood,
      delivery_references = null,
      delivery_postal_code = null,
      items = [],
      subtotal,
      delivery_fee = 0,
      total,
      estimated_delivery_time = null,
      special_instructions = null
    } = orderData;

    // Validaciones básicas
    if (!restaurant_id || !customer_phone || !items || items.length === 0) {
      throw new ValidationError('Datos de pedido incompletos');
    }

    if (!delivery_street || !delivery_number || !delivery_neighborhood) {
      throw new ValidationError('Dirección de entrega incompleta');
    }

    if (subtotal <= 0 || total <= 0) {
      throw new ValidationError('Montos del pedido inválidos');
    }

    try {
      return await transaction(async (client) => {
        // Crear el pedido principal
        const orderResult = await client.query(
          `INSERT INTO orders (
            id, restaurant_id, customer_id, conversation_id, customer_phone, customer_name,
            delivery_street, delivery_number, delivery_neighborhood, 
            delivery_references, delivery_postal_code,
            subtotal, delivery_fee, total, estimated_delivery_time, special_instructions
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING *`,
          [
            uuidv4(), restaurant_id, customer_id, conversation_id, customer_phone, customer_name,
            delivery_street, delivery_number, delivery_neighborhood,
            delivery_references, delivery_postal_code,
            subtotal, delivery_fee, total, estimated_delivery_time, special_instructions
          ]
        );

        const order = orderResult.rows[0];

        // Crear los items del pedido
        for (const item of items) {
          await client.query(
            `INSERT INTO order_items (
              id, order_id, menu_item_id, item_name, base_price, quantity,
              customizations, customizations_cost, item_total, special_notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              uuidv4(),
              order.id,
              item.menu_item_id,
              item.name,
              item.base_price,
              item.quantity,
              JSON.stringify(item.customizations || []),
              item.customizations_cost || 0,
              item.item_total,
              item.notes || null
            ]
          );
        }

        // Actualizar estadísticas del cliente si existe
        if (customer_id) {
          await client.query(
            `UPDATE customers 
             SET total_orders = total_orders + 1,
                 total_spent = total_spent + $1,
                 last_order_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [total, customer_id]
          );
        }

        logger.info('Pedido creado exitosamente', {
          orderId: order.id,
          restaurantId: restaurant_id,
          customerPhone: customer_phone.substring(0, 8) + '****',
          total: total,
          itemsCount: items.length
        });

        return order;
      });

    } catch (error) {
      logger.error('Error creando pedido:', error);
      throw new DatabaseError('Error al crear pedido', error);
    }
  }

  /**
   * Obtiene un pedido por ID
   * @param {string} orderId - ID del pedido
   * @param {string} restaurantId - ID del restaurante (opcional, para verificación)
   * @returns {Promise<Object|null>} Pedido con sus items
   */
  static async findById(orderId, restaurantId = null) {
    try {
      let whereClause = 'WHERE o.id = $1';
      const values = [orderId];

      if (restaurantId) {
        whereClause += ' AND o.restaurant_id = $2';
        values.push(restaurantId);
      }

      // Obtener datos del pedido
      const orderResult = await query(
        `SELECT 
          o.*,
          r.name as restaurant_name,
          r.phone as restaurant_phone
        FROM orders o
        JOIN restaurants r ON o.restaurant_id = r.id
        ${whereClause}`,
        values,
        'find_order_by_id'
      );

      if (orderResult.rows.length === 0) {
        return null;
      }

      const order = orderResult.rows[0];

      // Obtener items del pedido
      const itemsResult = await query(
        `SELECT 
          oi.*,
          mi.description as menu_item_description,
          mi.image_url as menu_item_image
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at`,
        [orderId],
        'get_order_items'
      );

      // Parsear customizaciones
      order.items = itemsResult.rows.map(item => ({
        ...item,
        customizations: JSON.parse(item.customizations || '[]')
      }));

      return order;

    } catch (error) {
      logger.error('Error obteniendo pedido por ID:', error);
      throw new DatabaseError('Error al obtener pedido', error);
    }
  }

  /**
   * Actualiza el estado de un pedido
   * @param {string} orderId - ID del pedido
   * @param {string} newStatus - Nuevo estado
   * @param {Object} additionalData - Datos adicionales
   * @returns {Promise<Object>} Pedido actualizado
   */
  static async updateStatus(orderId, newStatus, additionalData = {}) {
    const validStatuses = Object.values(ORDER_STATUS);
    
    if (!validStatuses.includes(newStatus)) {
      throw new ValidationError('Estado de pedido inválido');
    }

    try {
      const fields = ['status = $2'];
      const values = [orderId, newStatus];
      let paramCount = 3;

      // Agregar timestamp específico según el estado
      if (newStatus === ORDER_STATUS.DELIVERED) {
        fields.push(`delivered_at = CURRENT_TIMESTAMP`);
      }

      // Agregar notas internas si se proporcionan
      if (additionalData.internal_notes) {
        fields.push(`internal_notes = $${paramCount}`);
        values.push(additionalData.internal_notes);
        paramCount++;
      }

      // Agregar tiempo estimado si se proporciona
      if (additionalData.estimated_delivery_time) {
        fields.push(`estimated_delivery_time = $${paramCount}`);
        values.push(additionalData.estimated_delivery_time);
        paramCount++;
      }

      const result = await query(
        `UPDATE orders 
         SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        values,
        'update_order_status'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Pedido');
      }

      logger.info('Estado de pedido actualizado', {
        orderId,
        newStatus,
        previousStatus: result.rows[0].status
      });

      return result.rows[0];

    } catch (error) {
      logger.error('Error actualizando estado de pedido:', error);
      throw new DatabaseError('Error al actualizar pedido', error);
    }
  }

  /**
   * Obtiene pedidos de un restaurante con filtros
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Lista paginada de pedidos
   */
  static async findByRestaurant(restaurantId, options = {}) {
    const {
      page = 1,
      limit = 20,
      status = null,
      customerPhone = null,
      startDate = null,
      endDate = null,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;
    const validSortFields = ['created_at', 'total', 'status', 'customer_name'];
    const validSortOrders = ['ASC', 'DESC'];

    if (!validSortFields.includes(sortBy)) {
      throw new ValidationError('Campo de ordenamiento inválido');
    }

    if (!validSortOrders.includes(sortOrder.toUpperCase())) {
      throw new ValidationError('Orden de ordenamiento inválido');
    }

    try {
      const conditions = ['o.restaurant_id = $1'];
      const values = [restaurantId];
      let paramCount = 2;

      if (status) {
        conditions.push(`o.status = $${paramCount}`);
        values.push(status);
        paramCount++;
      }

      if (customerPhone) {
        conditions.push(`o.customer_phone = $${paramCount}`);
        values.push(customerPhone);
        paramCount++;
      }

      if (startDate) {
        conditions.push(`o.created_at >= $${paramCount}`);
        values.push(startDate);
        paramCount++;
      }

      if (endDate) {
        conditions.push(`o.created_at <= $${paramCount}`);
        values.push(endDate);
        paramCount++;
      }

      const whereClause = conditions.join(' AND ');

      // Consulta principal
      const ordersResult = await query(
        `SELECT 
          o.id, o.customer_phone, o.customer_name, o.status,
          o.total, o.created_at, o.estimated_delivery_time,
          o.delivery_neighborhood,
          COUNT(oi.id) as items_count
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE ${whereClause}
        GROUP BY o.id
        ORDER BY o.${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset],
        'find_orders_by_restaurant'
      );

      // Contar total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
        values.slice(0, -2),
        'count_orders_by_restaurant'
      );

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        orders: ordersResult.rows,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_items: total,
          items_per_page: limit,
          has_next: page < totalPages,
          has_prev: page > 1
        }
      };

    } catch (error) {
      logger.error('Error obteniendo pedidos por restaurante:', error);
      throw new DatabaseError('Error al obtener pedidos', error);
    }
  }

  /**
   * Obtiene pedidos de un cliente
   * @param {string} customerPhone - Teléfono del cliente
   * @param {string} restaurantId - ID del restaurante (opcional)
   * @param {number} limit - Límite de resultados
   * @returns {Promise<Array>} Lista de pedidos del cliente
   */
  static async findByCustomer(customerPhone, restaurantId = null, limit = 10) {
    try {
      let whereClause = 'WHERE o.customer_phone = $1';
      const values = [customerPhone];

      if (restaurantId) {
        whereClause += ' AND o.restaurant_id = $2';
        values.push(restaurantId);
        values.push(limit);
      } else {
        values.push(limit);
      }

      const result = await query(
        `SELECT 
          o.*,
          r.name as restaurant_name,
          COUNT(oi.id) as items_count
        FROM orders o
        JOIN restaurants r ON o.restaurant_id = r.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        ${whereClause}
        GROUP BY o.id, r.name
        ORDER BY o.created_at DESC
        LIMIT $${values.length}`,
        values,
        'find_orders_by_customer'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo pedidos por cliente:', error);
      throw new DatabaseError('Error al obtener pedidos del cliente', error);
    }
  }

  /**
   * Obtiene estadísticas de pedidos
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas de pedidos
   */
  static async getStats(restaurantId, dateRange = {}) {
    const { startDate, endDate } = dateRange;
    
    try {
      let dateCondition = '';
      const values = [restaurantId];

      if (startDate && endDate) {
        dateCondition = 'AND o.created_at BETWEEN $2 AND $3';
        values.push(startDate, endDate);
      }

      const result = await query(
        `SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
          COUNT(CASE WHEN status = 'preparing' THEN 1 END) as preparing_orders,
          COUNT(DISTINCT customer_phone) as unique_customers,
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(AVG(total), 0) as average_order_value,
          COALESCE(SUM(delivery_fee), 0) as total_delivery_fees,
          AVG(CASE 
            WHEN delivered_at IS NOT NULL THEN 
              EXTRACT(EPOCH FROM (delivered_at - created_at))/60 
            END) as avg_delivery_time_minutes
        FROM orders o
        WHERE restaurant_id = $1 ${dateCondition}`,
        values,
        'get_order_stats'
      );

      const stats = result.rows[0];

      // Calcular tasas
      const totalOrders = parseInt(stats.total_orders);
      stats.delivery_rate = totalOrders > 0 
        ? ((parseInt(stats.delivered_orders) / totalOrders) * 100).toFixed(2)
        : 0;

      stats.cancellation_rate = totalOrders > 0
        ? ((parseInt(stats.cancelled_orders) / totalOrders) * 100).toFixed(2)
        : 0;

      stats.average_order_value = parseFloat(stats.average_order_value || 0).toFixed(2);
      stats.avg_delivery_time_minutes = parseFloat(stats.avg_delivery_time_minutes || 0).toFixed(2);

      return stats;

    } catch (error) {
      logger.error('Error obteniendo estadísticas de pedidos:', error);
      throw new DatabaseError('Error al obtener estadísticas', error);
    }
  }

  /**
   * Obtiene los items más vendidos
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @param {number} limit - Límite de resultados
   * @returns {Promise<Array>} Items más vendidos
   */
  static async getTopItems(restaurantId, dateRange = {}, limit = 10) {
    const { startDate, endDate } = dateRange;
    
    try {
      let dateCondition = '';
      const values = [restaurantId];

      if (startDate && endDate) {
        dateCondition = 'AND o.created_at BETWEEN $2 AND $3';
        values.push(startDate, endDate);
        values.push(limit);
      } else {
        values.push(limit);
      }

      const result = await query(
        `SELECT 
          oi.item_name,
          oi.menu_item_id,
          COUNT(*) as order_count,
          SUM(oi.quantity) as total_quantity,
          SUM(oi.item_total) as total_revenue,
          AVG(oi.base_price) as avg_price,
          mi.image_url
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE o.restaurant_id = $1 AND o.status != 'cancelled' ${dateCondition}
        GROUP BY oi.menu_item_id, oi.item_name, mi.image_url
        ORDER BY total_quantity DESC, order_count DESC
        LIMIT $${values.length}`,
        values,
        'get_top_items'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo items más vendidos:', error);
      throw new DatabaseError('Error al obtener items populares', error);
    }
  }

  /**
   * Obtiene pedidos activos (en preparación/camino)
   * @param {string} restaurantId - ID del restaurante
   * @returns {Promise<Array>} Pedidos activos
   */
  static async getActiveOrders(restaurantId) {
    try {
      const result = await query(
        `SELECT 
          o.*,
          COUNT(oi.id) as items_count,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o.created_at))/60 as minutes_since_order
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.restaurant_id = $1 
        AND o.status IN ('confirmed', 'preparing', 'ready', 'out_for_delivery')
        GROUP BY o.id
        ORDER BY o.created_at ASC`,
        [restaurantId],
        'get_active_orders'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo pedidos activos:', error);
      throw new DatabaseError('Error al obtener pedidos activos', error);
    }
  }

  /**
   * Cancela un pedido
   * @param {string} orderId - ID del pedido
   * @param {string} reason - Razón de cancelación
   * @returns {Promise<Object>} Pedido cancelado
   */
  static async cancel(orderId, reason = null) {
    try {
      // Verificar que el pedido pueda ser cancelado
      const order = await this.findById(orderId);
      if (!order) {
        throw new NotFoundError('Pedido');
      }

      if (order.status === ORDER_STATUS.DELIVERED) {
        throw new ValidationError('No se puede cancelar un pedido ya entregado');
      }

      if (order.status === ORDER_STATUS.CANCELLED) {
        throw new ValidationError('El pedido ya está cancelado');
      }

      const result = await this.updateStatus(orderId, ORDER_STATUS.CANCELLED, {
        internal_notes: reason ? `Cancelado: ${reason}` : 'Pedido cancelado'
      });

      logger.info('Pedido cancelado', {
        orderId,
        reason,
        previousStatus: order.status
      });

      return result;

    } catch (error) {
      logger.error('Error cancelando pedido:', error);
      throw new DatabaseError('Error al cancelar pedido', error);
    }
  }

  /**
   * Calcula el tiempo estimado de entrega
   * @param {string} restaurantId - ID del restaurante
   * @param {string} neighborhood - Colonia de entrega
   * @returns {Promise<number>} Tiempo estimado en minutos
   */
  static async calculateDeliveryTime(restaurantId, neighborhood = null) {
    try {
      // Obtener configuración base del restaurante
      const restaurantResult = await query(
        'SELECT delivery_time_min, delivery_time_max FROM restaurants WHERE id = $1',
        [restaurantId],
        'get_restaurant_delivery_times'
      );

      if (restaurantResult.rows.length === 0) {
        return 30; // Valor por defecto
      }

      const { delivery_time_min, delivery_time_max } = restaurantResult.rows[0];

      // Verificar si hay zona específica con tiempo extra
      if (neighborhood) {
        const zoneResult = await query(
          `SELECT extra_fee FROM delivery_zones 
           WHERE restaurant_id = $1 AND $2 = ANY(neighborhoods) AND is_active = true`,
          [restaurantId, neighborhood],
          'check_delivery_zone'
        );

        // Si está en zona especial, agregar tiempo extra
        if (zoneResult.rows.length > 0) {
          return delivery_time_max + 10; // 10 minutos extra para zonas especiales
        }
      }

      // Calcular basado en pedidos actuales
      const activeOrdersResult = await query(
        `SELECT COUNT(*) as active_count 
         FROM orders 
         WHERE restaurant_id = $1 
         AND status IN ('confirmed', 'preparing')`,
        [restaurantId],
        'count_active_orders'
      );

      const activeCount = parseInt(activeOrdersResult.rows[0].active_count);

      // Ajustar tiempo basado en carga de trabajo
      let estimatedTime = delivery_time_min;
      if (activeCount > 5) {
        estimatedTime = delivery_time_max;
      } else if (activeCount > 2) {
        estimatedTime = Math.round((delivery_time_min + delivery_time_max) / 2);
      }

      return estimatedTime;

    } catch (error) {
      logger.error('Error calculando tiempo de entrega:', error);
      return 30; // Valor por defecto en caso de error
    }
  }

  /**
   * Obtiene el resumen de ventas por período
   * @param {string} restaurantId - ID del restaurante
   * @param {string} period - Período: 'today', 'week', 'month'
   * @returns {Promise<Object>} Resumen de ventas
   */
  static async getSalesSummary(restaurantId, period = 'today') {
    try {
      let dateCondition = '';
      
      switch (period) {
        case 'today':
          dateCondition = "AND DATE(created_at) = CURRENT_DATE";
          break;
        case 'week':
          dateCondition = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
          break;
        case 'month':
          dateCondition = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";
          break;
        default:
          dateCondition = "AND DATE(created_at) = CURRENT_DATE";
      }

      const result = await query(
        `SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as completed_orders,
          COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) as total_sales,
          COALESCE(AVG(CASE WHEN status = 'delivered' THEN total ELSE NULL END), 0) as avg_order_value,
          COUNT(DISTINCT customer_phone) as unique_customers
        FROM orders 
        WHERE restaurant_id = $1 ${dateCondition}`,
        [restaurantId],
        'get_sales_summary'
      );

      const summary = result.rows[0];
      summary.period = period;
      summary.completion_rate = summary.total_orders > 0 
        ? ((summary.completed_orders / summary.total_orders) * 100).toFixed(2)
        : 0;

      return summary;

    } catch (error) {
      logger.error('Error obteniendo resumen de ventas:', error);
      throw new DatabaseError('Error al obtener resumen de ventas', error);
    }
  }
}

module.exports = Order;