const { query, transaction } = require('../connection');
const logger = require('../../src/utils/logger');
const { v4: uuidv4 } = require('uuid');

// ============================================
// CONSULTAS OPTIMIZADAS PARA CLIENTES
// ============================================

/**
 * Busca cliente por teléfono
 * @param {string} phone - Número de teléfono
 * @returns {Promise<Object|null>} Cliente encontrado
 */
const findByPhone = async (phone) => {
  try {
    const result = await query(
      `SELECT 
        c.*,
        CASE 
          WHEN c.total_orders > 0 THEN c.total_spent / c.total_orders 
          ELSE 0 
        END as avg_order_value,
        CASE
          WHEN c.last_order_at IS NOT NULL THEN
            EXTRACT(DAYS FROM (NOW() - c.last_order_at))
          ELSE NULL
        END as days_since_last_order
      FROM customers c 
      WHERE c.phone = $1`,
      [phone],
      'find_customer_by_phone'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error buscando cliente por teléfono:', error);
    throw error;
  }
};

/**
 * Crea un nuevo cliente
 * @param {Object} customerData - Datos del cliente
 * @returns {Promise<Object>} Cliente creado
 */
const createCustomer = async (customerData) => {
  const {
    phone,
    name = null,
    defaultAddress = null,
    defaultReferences = null
  } = customerData;

  try {
    const result = await query(
      `INSERT INTO customers (
        id, phone, name, default_address, default_references, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *`,
      [
        uuidv4(),
        phone,
        name,
        defaultAddress,
        defaultReferences
      ],
      'create_customer'
    );

    logger.info('Nuevo cliente creado', {
      customerId: result.rows[0].id,
      phone: phone.substring(0, 8) + '****'
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error creando cliente:', error);
    throw error;
  }
};

/**
 * Encuentra cliente existente o crea uno nuevo
 * @param {string} phone - Número de teléfono
 * @param {Object} additionalData - Datos adicionales si se crea
 * @returns {Promise<Object>} Cliente existente o nuevo
 */
const findOrCreate = async (phone, additionalData = {}) => {
  try {
    // Primero buscar cliente existente
    let customer = await findByPhone(phone);
    
    if (customer) {
      return customer;
    }

    // Si no existe, crear uno nuevo
    return await createCustomer({ phone, ...additionalData });
  } catch (error) {
    logger.error('Error en findOrCreate cliente:', error);
    throw error;
  }
};

/**
 * Actualiza datos del cliente
 * @param {string} customerId - ID del cliente
 * @param {Object} updateData - Datos a actualizar
 * @returns {Promise<Object>} Cliente actualizado
 */
const updateCustomer = async (customerId, updateData) => {
  const allowedFields = [
    'name', 'default_address', 'default_references'
  ];

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
    throw new Error('No hay campos válidos para actualizar');
  }

  try {
    const result = await query(
      `UPDATE customers 
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING *`,
      [...values, customerId],
      'update_customer'
    );

    if (result.rows.length === 0) {
      throw new Error('Cliente no encontrado');
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando cliente:', error);
    throw error;
  }
};

/**
 * Actualiza estadísticas del cliente tras un pedido
 * @param {string} customerId - ID del cliente
 * @param {number} orderTotal - Total del pedido
 * @param {boolean} isFirstOrder - Si es el primer pedido
 * @returns {Promise<Object>} Cliente actualizado
 */
const updateOrderStats = async (customerId, orderTotal, isFirstOrder = false) => {
  try {
    const result = await query(
      `UPDATE customers 
       SET total_orders = total_orders + 1,
           total_spent = total_spent + $2,
           last_order_at = NOW(),
           first_order_at = CASE 
             WHEN $3 THEN NOW() 
             ELSE first_order_at 
           END
       WHERE id = $1
       RETURNING *`,
      [customerId, orderTotal, isFirstOrder],
      'update_customer_order_stats'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando estadísticas del cliente:', error);
    throw error;
  }
};

/**
 * Obtiene lista de clientes con paginación
 * @param {Object} options - Opciones de consulta
 * @returns {Promise<Object>} Lista paginada de clientes
 */
const getCustomersPaginated = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    sortBy = 'last_order_at',
    sortOrder = 'DESC',
    minOrders = null,
    minSpent = null
  } = options;

  const offset = (page - 1) * limit;
  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Filtro de búsqueda
  if (search) {
    conditions.push(`(c.phone ILIKE $${paramCount} OR c.name ILIKE $${paramCount})`);
    values.push(`%${search}%`);
    paramCount++;
  }

  // Filtro por número mínimo de pedidos
  if (minOrders !== null) {
    conditions.push(`c.total_orders >= $${paramCount}`);
    values.push(minOrders);
    paramCount++;
  }

  // Filtro por gasto mínimo
  if (minSpent !== null) {
    conditions.push(`c.total_spent >= $${paramCount}`);
    values.push(minSpent);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Consulta principal con métricas calculadas
    const customersResult = await query(
      `SELECT 
        c.*,
        CASE 
          WHEN c.total_orders > 0 THEN ROUND(c.total_spent / c.total_orders, 2)
          ELSE 0 
        END as avg_order_value,
        CASE
          WHEN c.last_order_at IS NOT NULL THEN
            EXTRACT(DAYS FROM (NOW() - c.last_order_at))::integer
          ELSE NULL
        END as days_since_last_order,
        CASE
          WHEN c.first_order_at IS NOT NULL THEN
            EXTRACT(DAYS FROM (NOW() - c.first_order_at))::integer
          ELSE NULL
        END as customer_lifetime_days,
        -- Clasificación del cliente
        CASE
          WHEN c.total_orders = 0 THEN 'new'
          WHEN c.total_orders = 1 THEN 'first_time'
          WHEN c.total_orders BETWEEN 2 AND 5 THEN 'occasional'
          WHEN c.total_orders BETWEEN 6 AND 15 THEN 'regular'
          ELSE 'loyal'
        END as customer_segment
      FROM customers c 
      ${whereClause}
      ORDER BY c.${sortBy} ${sortOrder} NULLS LAST
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...values, limit, offset],
      'get_customers_paginated'
    );

    // Contar total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM customers c ${whereClause}`,
      values,
      'count_customers'
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      customers: customersResult.rows,
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
    logger.error('Error obteniendo clientes paginados:', error);
    throw error;
  }
};

/**
 * Obtiene estadísticas generales de clientes
 * @param {Object} dateRange - Rango de fechas opcional
 * @returns {Promise<Object>} Estadísticas de clientes
 */
const getCustomerStats = async (dateRange = {}) => {
  const { startDate, endDate } = dateRange;
  const conditions = [];
  const values = [];
  
  if (startDate && endDate) {
    conditions.push('created_at BETWEEN $1 AND $2');
    values.push(startDate, endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN total_orders = 0 THEN 1 END) as new_customers,
        COUNT(CASE WHEN total_orders = 1 THEN 1 END) as first_time_customers,
        COUNT(CASE WHEN total_orders BETWEEN 2 AND 5 THEN 1 END) as occasional_customers,
        COUNT(CASE WHEN total_orders BETWEEN 6 AND 15 THEN 1 END) as regular_customers,
        COUNT(CASE WHEN total_orders > 15 THEN 1 END) as loyal_customers,
        
        -- Métricas de valor
        COALESCE(AVG(total_spent), 0) as avg_customer_value,
        COALESCE(AVG(CASE WHEN total_orders > 0 THEN total_spent / total_orders END), 0) as avg_order_value,
        COALESCE(AVG(total_orders), 0) as avg_orders_per_customer,
        
        -- Métricas de tiempo
        COALESCE(AVG(CASE 
          WHEN last_order_at IS NOT NULL THEN 
            EXTRACT(DAYS FROM (NOW() - last_order_at))
        END), 0) as avg_days_since_last_order,
        
        -- Distribución geográfica básica (por códigos de área)
        jsonb_object_agg(
          phone_area,
          area_count
        ) as phone_area_distribution
        
      FROM customers c
      LEFT JOIN (
        SELECT 
          SUBSTRING(phone FROM 1 FOR 5) as phone_area,
          COUNT(*) as area_count
        FROM customers
        ${whereClause}
        GROUP BY SUBSTRING(phone FROM 1 FOR 5)
      ) areas ON true
      ${whereClause}`,
      values,
      'get_customer_stats'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error obteniendo estadísticas de clientes:', error);
    throw error;
  }
};

/**
 * Obtiene clientes top por valor gastado
 * @param {number} limit - Cantidad de clientes top a obtener
 * @param {string} restaurantId - ID del restaurante (opcional)
 * @returns {Promise<Array>} Lista de clientes top
 */
const getTopCustomersByValue = async (limit = 10, restaurantId = null) => {
  try {
    let query_text = `
      SELECT 
        c.*,
        CASE 
          WHEN c.total_orders > 0 THEN ROUND(c.total_spent / c.total_orders, 2)
          ELSE 0 
        END as avg_order_value,
        CASE
          WHEN c.last_order_at IS NOT NULL THEN
            EXTRACT(DAYS FROM (NOW() - c.last_order_at))::integer
          ELSE NULL
        END as days_since_last_order
      FROM customers c`;

    const values = [limit];

    if (restaurantId) {
      query_text += `
        WHERE c.id IN (
          SELECT DISTINCT o.customer_id 
          FROM orders o 
          WHERE o.restaurant_id = $2 AND o.customer_id IS NOT NULL
        )`;
      values.push(restaurantId);
    }

    query_text += `
      ORDER BY c.total_spent DESC, c.total_orders DESC
      LIMIT $1`;

    const result = await query(query_text, values, 'get_top_customers_by_value');

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo clientes top por valor:', error);
    throw error;
  }
};

/**
 * Obtiene historial de pedidos de un cliente
 * @param {string} customerId - ID del cliente
 * @param {Object} options - Opciones de consulta
 * @returns {Promise<Array>} Historial de pedidos
 */
const getCustomerOrderHistory = async (customerId, options = {}) => {
  const { limit = 20, restaurantId = null } = options;
  
  const conditions = ['o.customer_id = $1'];
  const values = [customerId];
  let paramCount = 2;

  if (restaurantId) {
    conditions.push(`o.restaurant_id = $${paramCount}`);
    values.push(restaurantId);
    paramCount++;
  }

  try {
    const result = await query(
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
      'get_customer_order_history'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo historial de pedidos del cliente:', error);
    throw error;
  }
};

/**
 * Obtiene items favoritos de un cliente
 * @param {string} customerId - ID del cliente
 * @param {string} restaurantId - ID del restaurante (opcional)
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>} Items favoritos
 */
const getCustomerFavoriteItems = async (customerId, restaurantId = null, limit = 10) => {
  const conditions = ['o.customer_id = $1'];
  const values = [customerId];
  let paramCount = 2;

  if (restaurantId) {
    conditions.push(`o.restaurant_id = $${paramCount}`);
    values.push(restaurantId);
    paramCount++;
  }

  try {
    const result = await query(
      `SELECT 
        mi.id, mi.name, mi.description, mi.price, mi.image_url,
        mc.name as category_name,
        COUNT(oi.id) as order_count,
        SUM(oi.quantity) as total_quantity,
        ROUND(AVG(oi.item_total), 2) as avg_item_total,
        MAX(o.created_at) as last_ordered_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE ${conditions.join(' AND ')}
        AND o.status NOT IN ('cancelled')
      GROUP BY mi.id, mi.name, mi.description, mi.price, mi.image_url, mc.name
      ORDER BY order_count DESC, total_quantity DESC
      LIMIT $${paramCount}`,
      [...values, limit],
      'get_customer_favorite_items'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo items favoritos del cliente:', error);
    throw error;
  }
};

/**
 * Busca clientes similares basado en patrones de pedidos
 * @param {string} customerId - ID del cliente base
 * @param {string} restaurantId - ID del restaurante
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>} Clientes similares
 */
const findSimilarCustomers = async (customerId, restaurantId, limit = 5) => {
  try {
    const result = await query(
      `WITH customer_items AS (
        SELECT DISTINCT oi.menu_item_id
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.customer_id = $1 AND o.restaurant_id = $2
      ),
      similar_customers AS (
        SELECT 
          o2.customer_id,
          COUNT(DISTINCT oi2.menu_item_id) as common_items,
          AVG(o2.total) as avg_order_value
        FROM orders o2
        JOIN order_items oi2 ON o2.id = oi2.order_id
        WHERE o2.restaurant_id = $2
          AND o2.customer_id != $1
          AND o2.customer_id IS NOT NULL
          AND oi2.menu_item_id IN (SELECT menu_item_id FROM customer_items)
        GROUP BY o2.customer_id
        HAVING COUNT(DISTINCT oi2.menu_item_id) > 0
      )
      SELECT 
        c.*,
        sc.common_items,
        sc.avg_order_value as similar_avg_order_value
      FROM similar_customers sc
      JOIN customers c ON sc.customer_id = c.id
      ORDER BY sc.common_items DESC, ABS(sc.avg_order_value - (
        SELECT AVG(total) FROM orders WHERE customer_id = $1 AND restaurant_id = $2
      )) ASC
      LIMIT $3`,
      [customerId, restaurantId, limit],
      'find_similar_customers'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error buscando clientes similares:', error);
    throw error;
  }
};

/**
 * Obtiene métricas de retención de clientes
 * @param {string} restaurantId - ID del restaurante (opcional)
 * @param {Object} dateRange - Rango de fechas
 * @returns {Promise<Object>} Métricas de retención
 */
const getRetentionMetrics = async (restaurantId = null, dateRange = {}) => {
  const { startDate, endDate } = dateRange;
  const conditions = [];
  const values = [];
  let paramCount = 1;

  if (restaurantId) {
    conditions.push(`o.restaurant_id = $${paramCount}`);
    values.push(restaurantId);
    paramCount++;
  }

  if (startDate && endDate) {
    conditions.push(`o.created_at BETWEEN $${paramCount} AND $${paramCount + 1}`);
    values.push(startDate, endDate);
    paramCount += 2;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await query(
      `WITH customer_metrics AS (
        SELECT 
          o.customer_id,
          COUNT(*) as total_orders,
          MIN(o.created_at) as first_order,
          MAX(o.created_at) as last_order,
          EXTRACT(DAYS FROM (MAX(o.created_at) - MIN(o.created_at))) as customer_lifespan_days
        FROM orders o
        ${whereClause}
        AND o.customer_id IS NOT NULL
        AND o.status NOT IN ('cancelled')
        GROUP BY o.customer_id
      )
      SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN total_orders > 1 THEN 1 END) as returning_customers,
        ROUND(
          (COUNT(CASE WHEN total_orders > 1 THEN 1 END)::numeric / 
           NULLIF(COUNT(*), 0)) * 100, 2
        ) as retention_rate,
        
        ROUND(AVG(total_orders), 2) as avg_orders_per_customer,
        ROUND(AVG(customer_lifespan_days), 1) as avg_customer_lifespan_days,
        
        -- Distribución por frecuencia
        COUNT(CASE WHEN total_orders = 1 THEN 1 END) as one_time_customers,
        COUNT(CASE WHEN total_orders BETWEEN 2 AND 3 THEN 1 END) as low_frequency,
        COUNT(CASE WHEN total_orders BETWEEN 4 AND 8 THEN 1 END) as medium_frequency,
        COUNT(CASE WHEN total_orders > 8 THEN 1 END) as high_frequency
        
      FROM customer_metrics`,
      values,
      'get_retention_metrics'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error obteniendo métricas de retención:', error);
    throw error;
  }
};

module.exports = {
  findByPhone,
  createCustomer,
  findOrCreate,
  updateCustomer,
  updateOrderStats,
  getCustomersPaginated,
  getCustomerStats,
  getTopCustomersByValue,
  getCustomerOrderHistory,
  getCustomerFavoriteItems,
  findSimilarCustomers,
  getRetentionMetrics
};