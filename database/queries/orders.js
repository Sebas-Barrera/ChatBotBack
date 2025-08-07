const { query, transaction } = require('../connection');
const logger = require('../../src/utils/logger');
const { v4: uuidv4 } = require('uuid');
const { ORDER_STATUS } = require('../../src/utils/constants');

// ============================================
// CONSULTAS OPTIMIZADAS PARA PEDIDOS
// ============================================

/**
 * Crea un nuevo pedido desde una conversación
 * @param {Object} orderData - Datos del pedido
 * @returns {Promise<Object>} Pedido creado con items
 */
const createOrder = async (orderData) => {
  const {
    restaurantId,
    customerPhone,
    customerId = null,
    items,
    deliveryAddress,
    orderNotes = null,
    paymentMethod = 'cash',
    deliveryFee = 0,
    subtotal,
    total
  } = orderData;

  try {
    return await transaction(async (client) => {
      // Crear el pedido principal
      const orderResult = await client.query(
        `INSERT INTO orders (
          id, restaurant_id, customer_phone, customer_id,
          delivery_address, order_notes, payment_method,
          delivery_fee, subtotal, total, status, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING *`,
        [
          uuidv4(),
          restaurantId,
          customerPhone,
          customerId,
          JSON.stringify(deliveryAddress),
          orderNotes,
          paymentMethod,
          deliveryFee,
          subtotal,
          total,
          ORDER_STATUS.CONFIRMED
        ]
      );

      const order = orderResult.rows[0];

      // Crear los items del pedido
      const orderItemsPromises = items.map(item => 
        client.query(
          `INSERT INTO order_items (
            id, order_id, menu_item_id, menu_item_name,
            quantity, base_price, customizations, customizations_cost,
            item_total, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
          RETURNING *`,
          [
            uuidv4(),
            order.id,
            item.menu_item_id,
            item.name,
            item.quantity,
            item.base_price,
            JSON.stringify(item.customizations || []),
            item.customizations_cost || 0,
            item.item_total,
            item.notes || null
          ]
        )
      );

      const orderItemsResults = await Promise.all(orderItemsPromises);
      order.items = orderItemsResults.map(result => result.rows[0]);

      logger.info('Pedido creado exitosamente', {
        orderId: order.id,
        restaurantId,
        customerPhone: customerPhone.substring(0, 8) + '****',
        total,
        itemsCount: items.length
      });

      return order;
    });
  } catch (error) {
    logger.error('Error creando pedido:', error);
    throw error;
  }
};

/**
 * Obtiene un pedido por ID con todos sus detalles
 * @param {string} orderId - ID del pedido
 * @param {string} restaurantId - ID del restaurante (opcional para validación)
 * @returns {Promise<Object|null>} Pedido completo
 */
const findById = async (orderId, restaurantId = null) => {
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
        r.phone as restaurant_phone,
        r.slug as restaurant_slug,
        c.name as customer_name,
        EXTRACT(EPOCH FROM (NOW() - o.created_at))/60 as minutes_since_created
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      LEFT JOIN customers c ON o.customer_id = c.id
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
        mi.image_url as menu_item_image
      FROM order_items oi
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at`,
      [orderId],
      'get_order_items'
    );

    order.items = itemsResult.rows;

    return order;
  } catch (error) {
    logger.error('Error obteniendo pedido por ID:', error);
    throw error;
  }
};

/**
 * Obtiene pedidos con filtros y paginación
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} filters - Filtros de búsqueda
 * @returns {Promise<Object>} Lista paginada de pedidos
 */
const getOrdersPaginated = async (restaurantId, filters = {}) => {
  const {
    page = 1,
    limit = 20,
    status = null,
    customerPhone = null,
    paymentMethod = null,
    dateFrom = null,
    dateTo = null,
    minTotal = null,
    maxTotal = null,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = filters;

  const offset = (page - 1) * limit;
  const conditions = ['o.restaurant_id = $1'];
  const values = [restaurantId];
  let paramCount = 2;

  // Agregar filtros
  if (status) {
    if (Array.isArray(status)) {
      conditions.push(`o.status = ANY($${paramCount}::text[])`);
      values.push(status);
    } else {
      conditions.push(`o.status = $${paramCount}`);
      values.push(status);
    }
    paramCount++;
  }

  if (customerPhone) {
    conditions.push(`o.customer_phone = $${paramCount}`);
    values.push(customerPhone);
    paramCount++;
  }

  if (paymentMethod) {
    conditions.push(`o.payment_method = $${paramCount}`);
    values.push(paymentMethod);
    paramCount++;
  }

  if (dateFrom) {
    conditions.push(`o.created_at >= $${paramCount}`);
    values.push(dateFrom);
    paramCount++;
  }

  if (dateTo) {
    conditions.push(`o.created_at <= $${paramCount}`);
    values.push(dateTo);
    paramCount++;
  }

  if (minTotal !== null) {
    conditions.push(`o.total >= $${paramCount}`);
    values.push(minTotal);
    paramCount++;
  }

  if (maxTotal !== null) {
    conditions.push(`o.total <= $${paramCount}`);
    values.push(maxTotal);
    paramCount++;
  }

  const whereClause = conditions.join(' AND ');

  try {
    // Consulta principal
    const ordersResult = await query(
      `SELECT 
        o.*,
        c.name as customer_name,
        COUNT(oi.id) as items_count,
        EXTRACT(EPOCH FROM (NOW() - o.created_at))/60 as minutes_since_created,
        CASE 
          WHEN o.status = '${ORDER_STATUS.CONFIRMED}' THEN 'Confirmado'
          WHEN o.status = '${ORDER_STATUS.PREPARING}' THEN 'Preparando'
          WHEN o.status = '${ORDER_STATUS.READY}' THEN 'Listo'
          WHEN o.status = '${ORDER_STATUS.OUT_FOR_DELIVERY}' THEN 'En camino'
          WHEN o.status = '${ORDER_STATUS.DELIVERED}' THEN 'Entregado'
          WHEN o.status = '${ORDER_STATUS.CANCELLED}' THEN 'Cancelado'
          ELSE o.status
        END as status_display
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE ${whereClause}
      GROUP BY o.id, c.name
      ORDER BY o.${sortBy} ${sortOrder}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...values, limit, offset],
      'get_orders_paginated'
    );

    // Contar total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
      values.slice(0, -2), // Remover limit y offset
      'count_orders'
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      orders: ordersResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    logger.error('Error obteniendo pedidos paginados:', error);
    throw error;
  }
};

/**
 * Obtiene pedidos activos (no entregados ni cancelados)
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Lista de pedidos activos
 */
const getActiveOrders = async (restaurantId, options = {}) => {
  const { limit = 50 } = options;

  try {
    const result = await query(
      `SELECT 
        o.*,
        c.name as customer_name,
        COUNT(oi.id) as items_count,
        EXTRACT(EPOCH FROM (NOW() - o.created_at))/60 as minutes_since_created,
        CASE 
          WHEN o.status = '${ORDER_STATUS.CONFIRMED}' THEN 1
          WHEN o.status = '${ORDER_STATUS.PREPARING}' THEN 2  
          WHEN o.status = '${ORDER_STATUS.READY}' THEN 3
          WHEN o.status = '${ORDER_STATUS.OUT_FOR_DELIVERY}' THEN 4
          ELSE 5
        END as status_priority
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.restaurant_id = $1
        AND o.status NOT IN ('${ORDER_STATUS.DELIVERED}', '${ORDER_STATUS.CANCELLED}')
      GROUP BY o.id, c.name
      ORDER BY status_priority, o.created_at ASC
      LIMIT $2`,
      [restaurantId, limit],
      'get_active_orders'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo pedidos activos:', error);
    throw error;
  }
};

/**
 * Actualiza el estado de un pedido
 * @param {string} orderId - ID del pedido
 * @param {string} newStatus - Nuevo estado
 * @param {Object} additionalData - Datos adicionales
 * @returns {Promise<Object>} Pedido actualizado
 */
const updateOrderStatus = async (orderId, newStatus, additionalData = {}) => {
  const { statusNotes = null, updatedBy = null } = additionalData;

  try {
    const timestampField = getTimestampFieldForStatus(newStatus);
    let updateQuery = `
      UPDATE orders 
      SET status = $1, 
          status_notes = COALESCE($2, status_notes),
          updated_at = NOW()`;

    const values = [newStatus, statusNotes];
    let paramCount = 3;

    // Agregar timestamp específico según el estado
    if (timestampField) {
      updateQuery += `, ${timestampField} = NOW()`;
    }

    updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
    values.push(orderId);

    const result = await query(updateQuery, values, 'update_order_status');

    if (result.rows.length === 0) {
      throw new Error('Pedido no encontrado');
    }

    logger.info('Estado de pedido actualizado', {
      orderId,
      newStatus,
      updatedBy: updatedBy || 'system'
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando estado del pedido:', error);
    throw error;
  }
};

/**
 * Obtiene estadísticas de pedidos
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} dateRange - Rango de fechas
 * @returns {Promise<Object>} Estadísticas de pedidos
 */
const getOrderStats = async (restaurantId, dateRange = {}) => {
  const { startDate, endDate } = dateRange;
  const conditions = ['restaurant_id = $1'];
  const values = [restaurantId];
  
  if (startDate && endDate) {
    conditions.push('created_at BETWEEN $2 AND $3');
    values.push(startDate, endDate);
  }

  const whereClause = conditions.join(' AND ');

  try {
    const result = await query(
      `SELECT 
        -- Conteos generales
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.CONFIRMED}' THEN 1 END) as confirmed_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.PREPARING}' THEN 1 END) as preparing_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.READY}' THEN 1 END) as ready_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.OUT_FOR_DELIVERY}' THEN 1 END) as out_for_delivery_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.DELIVERED}' THEN 1 END) as delivered_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.CANCELLED}' THEN 1 END) as cancelled_orders,
        
        -- Métricas financieras
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN status = '${ORDER_STATUS.DELIVERED}' THEN total END), 0) as delivered_revenue,
        COALESCE(AVG(total), 0) as avg_order_value,
        COALESCE(SUM(delivery_fee), 0) as total_delivery_fees,
        
        -- Métricas de tiempo
        COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))/60), 0) as avg_delivery_time_minutes,
        COALESCE(AVG(EXTRACT(EPOCH FROM (ready_at - created_at))/60), 0) as avg_preparation_time_minutes,
        
        -- Métricas por método de pago
        COUNT(CASE WHEN payment_method = 'cash' THEN 1 END) as cash_orders,
        COUNT(CASE WHEN payment_method = 'card' THEN 1 END) as card_orders,
        COUNT(CASE WHEN payment_method = 'transfer' THEN 1 END) as transfer_orders,
        
        -- Clientes únicos
        COUNT(DISTINCT customer_phone) as unique_customers,
        
        -- Tasas
        ROUND(
          (COUNT(CASE WHEN status = '${ORDER_STATUS.DELIVERED}' THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0)) * 100, 2
        ) as delivery_rate,
        
        ROUND(
          (COUNT(CASE WHEN status = '${ORDER_STATUS.CANCELLED}' THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0)) * 100, 2
        ) as cancellation_rate
        
      FROM orders 
      WHERE ${whereClause}`,
      values,
      'get_order_stats'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error obteniendo estadísticas de pedidos:', error);
    throw error;
  }
};

/**
 * Obtiene pedidos por cliente
 * @param {string} customerPhone - Teléfono del cliente
 * @param {string} restaurantId - ID del restaurante (opcional)
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Historial de pedidos del cliente
 */
const getCustomerOrders = async (customerPhone, restaurantId = null, options = {}) => {
  const { limit = 20, includeItems = false } = options;
  
  const conditions = ['customer_phone = $1'];
  const values = [customerPhone];
  let paramCount = 2;

  if (restaurantId) {
    conditions.push(`restaurant_id = $${paramCount}`);
    values.push(restaurantId);
    paramCount++;
  }

  try {
    const ordersResult = await query(
      `SELECT 
        o.*,
        r.name as restaurant_name,
        r.slug as restaurant_slug,
        COUNT(oi.id) as items_count
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.id, r.name, r.slug
      ORDER BY o.created_at DESC
      LIMIT $${paramCount}`,
      [...values, limit],
      'get_customer_orders'
    );

    const orders = ordersResult.rows;

    // Si se solicitan los items, obtenerlos por separado
    if (includeItems && orders.length > 0) {
      const orderIds = orders.map(order => order.id);
      
      const itemsResult = await query(
        `SELECT 
          oi.*,
          mi.image_url as menu_item_image
        FROM order_items oi
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE oi.order_id = ANY($1::uuid[])
        ORDER BY oi.order_id, oi.created_at`,
        [orderIds],
        'get_multiple_order_items'
      );

      // Agrupar items por pedido
      const itemsByOrder = {};
      itemsResult.rows.forEach(item => {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = [];
        }
        itemsByOrder[item.order_id].push(item);
      });

      // Agregar items a cada pedido
      orders.forEach(order => {
        order.items = itemsByOrder[order.id] || [];
      });
    }

    return orders;
  } catch (error) {
    logger.error('Error obteniendo pedidos del cliente:', error);
    throw error;
  }
};

/**
 * Busca pedidos por texto
 * @param {string} restaurantId - ID del restaurante
 * @param {string} searchTerm - Término de búsqueda
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Array>} Pedidos encontrados
 */
const searchOrders = async (restaurantId, searchTerm, options = {}) => {
  const { limit = 50 } = options;

  try {
    const result = await query(
      `SELECT DISTINCT
        o.*,
        c.name as customer_name,
        COUNT(oi.id) as items_count,
        EXTRACT(EPOCH FROM (NOW() - o.created_at))/60 as minutes_since_created
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.restaurant_id = $1
        AND (
          o.customer_phone ILIKE $2
          OR c.name ILIKE $2
          OR o.order_notes ILIKE $2
          OR o.status_notes ILIKE $2
          OR oi.menu_item_name ILIKE $2
          OR oi.notes ILIKE $2
          OR o.id::text ILIKE $2
        )
      GROUP BY o.id, c.name
      ORDER BY o.created_at DESC
      LIMIT $3`,
      [restaurantId, `%${searchTerm}%`, limit],
      'search_orders'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error buscando pedidos:', error);
    throw error;
  }
};

/**
 * Genera reporte de ventas
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} params - Parámetros del reporte
 * @returns {Promise<Object>} Reporte de ventas
 */
const generateSalesReport = async (restaurantId, params = {}) => {
  const {
    startDate,
    endDate,
    groupBy = 'day' // day, week, month
  } = params;

  try {
    let dateFormat;
    switch (groupBy) {
      case 'week':
        dateFormat = 'YYYY-"W"WW';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        break;
      default:
        dateFormat = 'YYYY-MM-DD';
    }

    const result = await query(
      `SELECT 
        TO_CHAR(created_at, '${dateFormat}') as period,
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.DELIVERED}' THEN 1 END) as delivered_orders,
        COUNT(CASE WHEN status = '${ORDER_STATUS.CANCELLED}' THEN 1 END) as cancelled_orders,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN status = '${ORDER_STATUS.DELIVERED}' THEN total END), 0) as delivered_revenue,
        COALESCE(AVG(total), 0) as avg_order_value,
        COUNT(DISTINCT customer_phone) as unique_customers
      FROM orders
      WHERE restaurant_id = $1
        AND created_at BETWEEN $2 AND $3
        AND status != '${ORDER_STATUS.CANCELLED}'
      GROUP BY TO_CHAR(created_at, '${dateFormat}')
      ORDER BY period`,
      [restaurantId, startDate, endDate],
      'generate_sales_report'
    );

    return {
      period_type: groupBy,
      date_range: { startDate, endDate },
      data: result.rows,
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error generando reporte de ventas:', error);
    throw error;
  }
};

/**
 * Obtiene items más vendidos
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} options - Opciones de consulta
 * @returns {Promise<Array>} Items más vendidos
 */
const getTopSellingItems = async (restaurantId, options = {}) => {
  const { limit = 20, days = 30 } = options;

  try {
    const result = await query(
      `SELECT 
        oi.menu_item_id,
        oi.menu_item_name,
        mi.image_url,
        mc.name as category_name,
        SUM(oi.quantity) as total_quantity,
        COUNT(DISTINCT oi.order_id) as order_count,
        ROUND(AVG(oi.item_total / oi.quantity), 2) as avg_unit_price,
        SUM(oi.item_total) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE o.restaurant_id = $1
        AND o.status NOT IN ('${ORDER_STATUS.CANCELLED}')
        AND o.created_at > NOW() - INTERVAL '$2 days'
      GROUP BY oi.menu_item_id, oi.menu_item_name, mi.image_url, mc.name
      ORDER BY total_quantity DESC, order_count DESC
      LIMIT $3`,
      [restaurantId, days, limit],
      'get_top_selling_items'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo items más vendidos:', error);
    throw error;
  }
};

/**
 * Cancela un pedido
 * @param {string} orderId - ID del pedido
 * @param {Object} cancellationData - Datos de la cancelación
 * @returns {Promise<Object>} Pedido cancelado
 */
const cancelOrder = async (orderId, cancellationData = {}) => {
  const { reason = 'Cancelado por el sistema', cancelledBy = null } = cancellationData;

  try {
    const result = await query(
      `UPDATE orders 
       SET status = $1,
           status_notes = $2,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND status NOT IN ('${ORDER_STATUS.DELIVERED}', '${ORDER_STATUS.CANCELLED}')
       RETURNING *`,
      [ORDER_STATUS.CANCELLED, reason, orderId],
      'cancel_order'
    );

    if (result.rows.length === 0) {
      throw new Error('Pedido no encontrado o no se puede cancelar');
    }

    logger.info('Pedido cancelado', {
      orderId,
      reason,
      cancelledBy: cancelledBy || 'system'
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error cancelando pedido:', error);
    throw error;
  }
};

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Obtiene el campo de timestamp correspondiente al estado
 * @param {string} status - Estado del pedido
 * @returns {string|null} Nombre del campo timestamp
 */
const getTimestampFieldForStatus = (status) => {
  const statusTimestamps = {
    [ORDER_STATUS.CONFIRMED]: 'confirmed_at',
    [ORDER_STATUS.PREPARING]: 'preparing_at',
    [ORDER_STATUS.READY]: 'ready_at',
    [ORDER_STATUS.OUT_FOR_DELIVERY]: 'out_for_delivery_at',
    [ORDER_STATUS.DELIVERED]: 'delivered_at',
    [ORDER_STATUS.CANCELLED]: 'cancelled_at'
  };

  return statusTimestamps[status] || null;
};

module.exports = {
  createOrder,
  findById,
  getOrdersPaginated,
  getActiveOrders,
  updateOrderStatus,
  getOrderStats,
  getCustomerOrders,
  searchOrders,
  generateSalesReport,
  getTopSellingItems,
  cancelOrder
};