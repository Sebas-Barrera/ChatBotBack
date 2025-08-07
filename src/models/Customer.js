const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { ValidationError, DatabaseError, NotFoundError } = require('../middleware/errorHandler');
const { formatPhoneNumber, isValidWhatsAppNumber } = require('../config/whatsapp');

// ============================================
// MODELO CUSTOMER
// ============================================

class Customer {

  /**
   * Crea o obtiene un cliente por teléfono
   * @param {string} phone - Número de teléfono
   * @param {Object} additionalData - Datos adicionales del cliente
   * @returns {Promise<Object>} Cliente creado o existente
   */
  static async findOrCreate(phone, additionalData = {}) {
    if (!phone) {
      throw new ValidationError('Número de teléfono es requerido');
    }

    const formattedPhone = formatPhoneNumber(phone);
    
    if (!isValidWhatsAppNumber(formattedPhone)) {
      throw new ValidationError('Número de teléfono inválido');
    }

    try {
      // Primero intentar encontrar cliente existente
      let customer = await this.findByPhone(formattedPhone);

      if (customer) {
        // Si hay datos adicionales, actualizar
        if (Object.keys(additionalData).length > 0) {
          customer = await this.update(customer.id, additionalData);
        }
        return customer;
      }

      // Crear nuevo cliente
      const {
        name = null,
        default_address = null,
        default_references = null
      } = additionalData;

      const result = await query(
        `INSERT INTO customers (
          id, phone, name, default_address, default_references, first_order_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *`,
        [uuidv4(), formattedPhone, name, default_address, default_references],
        'create_customer'
      );

      customer = result.rows[0];

      logger.info('Nuevo cliente creado', {
        customerId: customer.id,
        phone: formattedPhone.substring(0, 8) + '****'
      });

      return customer;

    } catch (error) {
      if (error.code === '23505') { // unique violation
        // Race condition - otro proceso creó el cliente
        return await this.findByPhone(formattedPhone);
      }

      logger.error('Error creando/obteniendo cliente:', error);
      throw new DatabaseError('Error al gestionar cliente', error);
    }
  }

  /**
   * Busca un cliente por teléfono
   * @param {string} phone - Número de teléfono
   * @returns {Promise<Object|null>} Cliente encontrado
   */
  static async findByPhone(phone) {
    try {
      const formattedPhone = formatPhoneNumber(phone);
      
      const result = await query(
        'SELECT * FROM customers WHERE phone = $1',
        [formattedPhone],
        'find_customer_by_phone'
      );

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Error buscando cliente por teléfono:', error);
      throw new DatabaseError('Error al buscar cliente', error);
    }
  }

  /**
   * Busca un cliente por ID
   * @param {string} customerId - ID del cliente
   * @returns {Promise<Object|null>} Cliente encontrado
   */
  static async findById(customerId) {
    try {
      const result = await query(
        'SELECT * FROM customers WHERE id = $1',
        [customerId],
        'find_customer_by_id'
      );

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Error buscando cliente por ID:', error);
      throw new DatabaseError('Error al buscar cliente', error);
    }
  }

  /**
   * Actualiza datos de un cliente
   * @param {string} customerId - ID del cliente
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} Cliente actualizado
   */
  static async update(customerId, updateData) {
    const allowedFields = ['name', 'default_address', 'default_references'];
    
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError('No hay campos válidos para actualizar');
    }

    values.push(customerId);

    try {
      const result = await query(
        `UPDATE customers 
         SET ${fields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        values,
        'update_customer'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Cliente');
      }

      logger.info('Cliente actualizado', {
        customerId,
        updatedFields: Object.keys(updateData)
      });

      return result.rows[0];

    } catch (error) {
      logger.error('Error actualizando cliente:', error);
      throw new DatabaseError('Error al actualizar cliente', error);
    }
  }

  /**
   * Obtiene el historial de pedidos de un cliente
   * @param {string} customerId - ID del cliente
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Object>} Historial paginado
   */
  static async getOrderHistory(customerId, options = {}) {
    const {
      page = 1,
      limit = 10,
      restaurantId = null,
      startDate = null,
      endDate = null
    } = options;

    const offset = (page - 1) * limit;

    try {
      const conditions = ['o.customer_id = $1'];
      const values = [customerId];
      let paramCount = 2;

      if (restaurantId) {
        conditions.push(`o.restaurant_id = $${paramCount}`);
        values.push(restaurantId);
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
          o.id, o.status, o.total, o.created_at, o.delivered_at,
          r.name as restaurant_name,
          COUNT(oi.id) as items_count
        FROM orders o
        JOIN restaurants r ON o.restaurant_id = r.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE ${whereClause}
        GROUP BY o.id, r.name
        ORDER BY o.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset],
        'get_customer_order_history'
      );

      // Contar total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
        values.slice(0, -2),
        'count_customer_orders'
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
      logger.error('Error obteniendo historial de pedidos:', error);
      throw new DatabaseError('Error al obtener historial', error);
    }
  }

  /**
   * Obtiene estadísticas de un cliente
   * @param {string} customerId - ID del cliente
   * @returns {Promise<Object>} Estadísticas del cliente
   */
  static async getStats(customerId) {
    try {
      const result = await query(
        `SELECT 
          c.total_orders,
          c.total_spent,
          c.first_order_at,
          c.last_order_at,
          COUNT(DISTINCT o.restaurant_id) as restaurants_visited,
          COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as completed_orders,
          COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) as cancelled_orders,
          COALESCE(AVG(CASE WHEN o.status = 'delivered' THEN o.total END), 0) as avg_order_value,
          
          -- Items favoritos
          (SELECT oi.item_name 
           FROM order_items oi 
           JOIN orders o2 ON oi.order_id = o2.id
           WHERE o2.customer_id = c.id AND o2.status = 'delivered'
           GROUP BY oi.item_name 
           ORDER BY COUNT(*) DESC 
           LIMIT 1) as favorite_item,
           
          -- Restaurante favorito
          (SELECT r.name 
           FROM orders o3 
           JOIN restaurants r ON o3.restaurant_id = r.id
           WHERE o3.customer_id = c.id AND o3.status = 'delivered'
           GROUP BY r.id, r.name 
           ORDER BY COUNT(*) DESC 
           LIMIT 1) as favorite_restaurant

        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        WHERE c.id = $1
        GROUP BY c.id`,
        [customerId],
        'get_customer_stats'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Cliente');
      }

      const stats = result.rows[0];

      // Calcular métricas adicionales
      stats.completion_rate = stats.total_orders > 0 
        ? ((stats.completed_orders / stats.total_orders) * 100).toFixed(2)
        : 0;

      stats.cancellation_rate = stats.total_orders > 0
        ? ((stats.cancelled_orders / stats.total_orders) * 100).toFixed(2)
        : 0;

      // Calcular días como cliente
      if (stats.first_order_at) {
        const daysSinceFirstOrder = Math.floor(
          (Date.now() - new Date(stats.first_order_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        stats.days_as_customer = daysSinceFirstOrder;
        stats.orders_per_month = daysSinceFirstOrder > 0 
          ? ((stats.total_orders / daysSinceFirstOrder) * 30).toFixed(2)
          : 0;
      }

      return stats;

    } catch (error) {
      logger.error('Error obteniendo estadísticas de cliente:', error);
      throw new DatabaseError('Error al obtener estadísticas', error);
    }
  }

  /**
   * Obtiene los items favoritos de un cliente
   * @param {string} customerId - ID del cliente
   * @param {number} limit - Límite de resultados
   * @returns {Promise<Array>} Items favoritos
   */
  static async getFavoriteItems(customerId, limit = 5) {
    try {
      const result = await query(
        `SELECT 
          oi.item_name,
          oi.menu_item_id,
          COUNT(*) as order_count,
          SUM(oi.quantity) as total_quantity,
          AVG(oi.base_price) as avg_price,
          MAX(o.created_at) as last_ordered,
          mi.image_url
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE o.customer_id = $1 AND o.status = 'delivered'
        GROUP BY oi.menu_item_id, oi.item_name, mi.image_url
        ORDER BY order_count DESC, total_quantity DESC
        LIMIT $2`,
        [customerId, limit],
        'get_customer_favorite_items'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo items favoritos del cliente:', error);
      throw new DatabaseError('Error al obtener items favoritos', error);
    }
  }

  /**
   * Obtiene clientes frecuentes de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} options - Opciones de consulta
   * @returns {Promise<Array>} Clientes frecuentes
   */
  static async getFrequentCustomers(restaurantId, options = {}) {
    const {
      limit = 20,
      minOrders = 3,
      period = null // 'month', 'week', etc.
    } = options;

    try {
      let dateCondition = '';
      const values = [restaurantId, minOrders, limit];

      if (period === 'month') {
        dateCondition = "AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'";
      } else if (period === 'week') {
        dateCondition = "AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'";
      }

      const result = await query(
        `SELECT 
          c.id,
          c.phone,
          c.name,
          c.default_address,
          COUNT(o.id) as total_orders,
          SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END) as total_spent,
          MAX(o.created_at) as last_order_date,
          AVG(CASE WHEN o.status = 'delivered' THEN o.total END) as avg_order_value
        FROM customers c
        JOIN orders o ON c.id = o.customer_id
        WHERE o.restaurant_id = $1 ${dateCondition}
        GROUP BY c.id
        HAVING COUNT(o.id) >= $2
        ORDER BY total_orders DESC, total_spent DESC
        LIMIT $3`,
        values,
        'get_frequent_customers'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo clientes frecuentes:', error);
      throw new DatabaseError('Error al obtener clientes frecuentes', error);
    }
  }

  /**
   * Busca clientes por criterios
   * @param {Object} searchCriteria - Criterios de búsqueda
   * @param {Object} options - Opciones de paginación
   * @returns {Promise<Object>} Resultados paginados
   */
  static async search(searchCriteria = {}, options = {}) {
    const {
      phone = null,
      name = null,
      minOrders = null,
      maxOrders = null,
      minSpent = null,
      maxSpent = null
    } = searchCriteria;

    const {
      page = 1,
      limit = 20,
      sortBy = 'total_orders',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * limit;

    try {
      const conditions = [];
      const values = [];
      let paramCount = 1;

      if (phone) {
        conditions.push(`c.phone ILIKE $${paramCount}`);
        values.push(`%${phone}%`);
        paramCount++;
      }

      if (name) {
        conditions.push(`c.name ILIKE $${paramCount}`);
        values.push(`%${name}%`);
        paramCount++;
      }

      if (minOrders !== null) {
        conditions.push(`c.total_orders >= $${paramCount}`);
        values.push(minOrders);
        paramCount++;
      }

      if (maxOrders !== null) {
        conditions.push(`c.total_orders <= $${paramCount}`);
        values.push(maxOrders);
        paramCount++;
      }

      if (minSpent !== null) {
        conditions.push(`c.total_spent >= $${paramCount}`);
        values.push(minSpent);
        paramCount++;
      }

      if (maxSpent !== null) {
        conditions.push(`c.total_spent <= $${paramCount}`);
        values.push(maxSpent);
        paramCount++;
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      // Consulta principal
      const customersResult = await query(
        `SELECT 
          c.*,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - c.last_order_at))/86400 as days_since_last_order
        FROM customers c
        ${whereClause}
        ORDER BY c.${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset],
        'search_customers'
      );

      // Contar total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM customers c ${whereClause}`,
        values.slice(0, -2),
        'count_search_customers'
      );

      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limit);

      return {
        customers: customersResult.rows,
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
      logger.error('Error buscando clientes:', error);
      throw new DatabaseError('Error al buscar clientes', error);
    }
  }

  /**
   * Actualiza estadísticas después de un pedido
   * Esta función es llamada automáticamente cuando se crea un pedido
   * @param {string} customerId - ID del cliente
   * @param {number} orderTotal - Total del pedido
   * @returns {Promise<boolean>} True si se actualizó correctamente
   */
  static async updateOrderStats(customerId, orderTotal) {
    try {
      await query(
        `UPDATE customers 
         SET total_orders = total_orders + 1,
             total_spent = total_spent + $1,
             last_order_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [orderTotal, customerId],
        'update_customer_order_stats'
      );

      return true;

    } catch (error) {
      logger.error('Error actualizando estadísticas de cliente:', error);
      // No lanzar error para no afectar el flujo del pedido
      return false;
    }
  }

  /**
   * Obtiene recomendaciones para un cliente basadas en su historial
   * @param {string} customerId - ID del cliente
   * @param {string} restaurantId - ID del restaurante
   * @param {number} limit - Límite de recomendaciones
   * @returns {Promise<Array>} Items recomendados
   */
  static async getRecommendations(customerId, restaurantId, limit = 5) {
    try {
      // Obtener items que el cliente no ha pedido pero que han pedido clientes similares
      const result = await query(
        `WITH customer_items AS (
          SELECT DISTINCT oi.menu_item_id
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.customer_id = $1 AND o.restaurant_id = $2
        ),
        similar_customers AS (
          SELECT DISTINCT o2.customer_id
          FROM orders o1
          JOIN orders o2 ON o1.restaurant_id = o2.restaurant_id
          JOIN order_items oi1 ON o1.id = oi1.order_id
          JOIN order_items oi2 ON o2.id = oi2.order_id
          WHERE o1.customer_id = $1 
          AND o1.restaurant_id = $2
          AND o2.customer_id != $1
          AND oi1.menu_item_id = oi2.menu_item_id
        ),
        recommended_items AS (
          SELECT 
            mi.id, mi.name, mi.description, mi.price, mi.image_url,
            COUNT(*) as popularity_score
          FROM menu_items mi
          JOIN order_items oi ON mi.id = oi.menu_item_id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.customer_id IN (SELECT customer_id FROM similar_customers)
          AND o.restaurant_id = $2
          AND mi.is_available = true
          AND mi.id NOT IN (SELECT menu_item_id FROM customer_items)
          GROUP BY mi.id
        )
        SELECT * FROM recommended_items
        ORDER BY popularity_score DESC
        LIMIT $3`,
        [customerId, restaurantId, limit],
        'get_customer_recommendations'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo recomendaciones para cliente:', error);
      // Retornar array vacío en caso de error
      return [];
    }
  }
}

module.exports = Customer;