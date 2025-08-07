const { query, transaction } = require('../connection');
const logger = require('../../src/utils/logger');
const { v4: uuidv4 } = require('uuid');

// ============================================
// CONSULTAS OPTIMIZADAS PARA RESTAURANTES
// ============================================

/**
 * Busca restaurante por slug
 * @param {string} slug - Slug del restaurante
 * @returns {Promise<Object|null>} Restaurante encontrado
 */
const findBySlug = async (slug) => {
  try {
    const result = await query(
      `SELECT 
        r.*,
        -- Estadísticas básicas
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = r.id) as total_orders,
        (SELECT COUNT(*) FROM menu_items WHERE restaurant_id = r.id AND is_available = true) as available_items,
        (SELECT COUNT(*) FROM conversations WHERE restaurant_id = r.id AND status = 'active') as active_conversations,
        -- Estado operacional
        CASE 
          WHEN r.is_active = false THEN 'closed'
          WHEN CURRENT_TIME BETWEEN r.opens_at AND r.closes_at THEN 'open'
          ELSE 'closed'
        END as current_status
      FROM restaurants r 
      WHERE r.slug = $1`,
      [slug],
      'find_restaurant_by_slug'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error buscando restaurante por slug:', error);
    throw error;
  }
};

/**
 * Busca restaurante por ID
 * @param {string} restaurantId - ID del restaurante
 * @returns {Promise<Object|null>} Restaurante encontrado
 */
const findById = async (restaurantId) => {
  try {
    const result = await query(
      `SELECT 
        r.*,
        -- Estadísticas detalladas
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = r.id) as total_orders,
        (SELECT COUNT(*) FROM orders WHERE restaurant_id = r.id AND status = 'delivered') as delivered_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE restaurant_id = r.id AND status = 'delivered') as total_revenue,
        (SELECT COUNT(*) FROM customers WHERE id IN (SELECT DISTINCT customer_id FROM orders WHERE restaurant_id = r.id)) as total_customers,
        (SELECT COUNT(*) FROM menu_categories WHERE restaurant_id = r.id AND is_active = true) as active_categories,
        (SELECT COUNT(*) FROM menu_items WHERE restaurant_id = r.id AND is_available = true) as available_items,
        (SELECT COUNT(*) FROM conversations WHERE restaurant_id = r.id AND status = 'active') as active_conversations,
        -- Estado operacional
        CASE 
          WHEN r.is_active = false THEN 'closed'
          WHEN CURRENT_TIME BETWEEN r.opens_at AND r.closes_at THEN 'open'
          ELSE 'closed'
        END as current_status
      FROM restaurants r 
      WHERE r.id = $1`,
      [restaurantId],
      'find_restaurant_by_id'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error buscando restaurante por ID:', error);
    throw error;
  }
};

/**
 * Crea un nuevo restaurante
 * @param {Object} restaurantData - Datos del restaurante
 * @returns {Promise<Object>} Restaurante creado
 */
const createRestaurant = async (restaurantData) => {
  const {
    name,
    slug,
    phone,
    email = null,
    address = null,
    logoUrl = null,
    opensAt = '09:00:00',
    closesAt = '23:00:00',
    deliveryTimeMin = 25,
    deliveryTimeMax = 35,
    deliveryFee = 0.00,
    minimumOrder = 0.00,
    whatsappPhoneId = null,
    whatsappToken = null,
    twilioPhoneNumber = null
  } = restaurantData;

  try {
    const result = await query(
      `INSERT INTO restaurants (
        id, name, slug, phone, email, address, logo_url,
        opens_at, closes_at, delivery_time_min, delivery_time_max,
        delivery_fee, minimum_order, whatsapp_phone_id, 
        whatsapp_token, twilio_phone_number, is_active, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 
        $12, $13, $14, $15, $16, true, NOW()
      )
      RETURNING *`,
      [
        uuidv4(),
        name,
        slug,
        phone,
        email,
        address,
        logoUrl,
        opensAt,
        closesAt,
        deliveryTimeMin,
        deliveryTimeMax,
        deliveryFee,
        minimumOrder,
        whatsappPhoneId,
        whatsappToken,
        twilioPhoneNumber
      ],
      'create_restaurant'
    );

    logger.info('Nuevo restaurante creado', {
      restaurantId: result.rows[0].id,
      name,
      slug
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error creando restaurante:', error);
    throw error;
  }
};

/**
 * Actualiza un restaurante
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} updateData - Datos a actualizar
 * @returns {Promise<Object>} Restaurante actualizado
 */
const updateRestaurant = async (restaurantId, updateData) => {
  const allowedFields = [
    'name', 'slug', 'phone', 'email', 'address', 'logo_url',
    'opens_at', 'closes_at', 'delivery_time_min', 'delivery_time_max',
    'delivery_fee', 'minimum_order', 'is_active', 'whatsapp_phone_id',
    'whatsapp_token', 'twilio_phone_number'
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
      `UPDATE restaurants 
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING *`,
      [...values, restaurantId],
      'update_restaurant'
    );

    if (result.rows.length === 0) {
      throw new Error('Restaurante no encontrado');
    }

    logger.info('Restaurante actualizado', {
      restaurantId,
      fieldsUpdated: Object.keys(updateData)
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando restaurante:', error);
    throw error;
  }
};

/**
 * Obtiene lista de restaurantes con paginación
 * @param {Object} filters - Filtros de búsqueda
 * @returns {Promise<Object>} Lista paginada de restaurantes
 */
const getRestaurantsPaginated = async (filters = {}) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    isActive = null,
    sortBy = 'created_at',
    sortOrder = 'DESC'
  } = filters;

  const offset = (page - 1) * limit;
  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Filtro de búsqueda
  if (search) {
    conditions.push(`(r.name ILIKE $${paramCount} OR r.slug ILIKE $${paramCount} OR r.phone ILIKE $${paramCount})`);
    values.push(`%${search}%`);
    paramCount++;
  }

  // Filtro por estado activo
  if (isActive !== null) {
    conditions.push(`r.is_active = $${paramCount}`);
    values.push(isActive);
    paramCount++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // Consulta principal con métricas
    const restaurantsResult = await query(
      `SELECT 
        r.*,
        -- Estadísticas operacionales
        COALESCE(stats.total_orders, 0) as total_orders,
        COALESCE(stats.delivered_orders, 0) as delivered_orders,
        COALESCE(stats.total_revenue, 0) as total_revenue,
        COALESCE(stats.total_customers, 0) as total_customers,
        COALESCE(stats.active_conversations, 0) as active_conversations,
        COALESCE(menu_stats.total_categories, 0) as total_categories,
        COALESCE(menu_stats.total_items, 0) as total_items,
        COALESCE(menu_stats.available_items, 0) as available_items,
        -- Estado actual
        CASE 
          WHEN r.is_active = false THEN 'inactive'
          WHEN CURRENT_TIME BETWEEN r.opens_at AND r.closes_at THEN 'open'
          ELSE 'closed'
        END as current_status,
        -- Última actividad
        COALESCE(activity.last_order_at, r.created_at) as last_activity
      FROM restaurants r
      LEFT JOIN (
        SELECT 
          restaurant_id,
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
          SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END) as total_revenue,
          COUNT(DISTINCT customer_id) as total_customers
        FROM orders
        GROUP BY restaurant_id
      ) stats ON r.id = stats.restaurant_id
      LEFT JOIN (
        SELECT 
          restaurant_id,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_conversations
        FROM conversations
        GROUP BY restaurant_id
      ) conv_stats ON r.id = conv_stats.restaurant_id
      LEFT JOIN (
        SELECT 
          mc.restaurant_id,
          COUNT(DISTINCT mc.id) as total_categories,
          COUNT(mi.id) as total_items,
          COUNT(CASE WHEN mi.is_available THEN 1 END) as available_items
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mc.id = mi.category_id
        GROUP BY mc.restaurant_id
      ) menu_stats ON r.id = menu_stats.restaurant_id
      LEFT JOIN (
        SELECT 
          restaurant_id,
          MAX(created_at) as last_order_at
        FROM orders
        GROUP BY restaurant_id
      ) activity ON r.id = activity.restaurant_id
      ${whereClause}
      ORDER BY r.${sortBy} ${sortOrder}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...values, limit, offset],
      'get_restaurants_paginated'
    );

    // Contar total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM restaurants r ${whereClause}`,
      values,
      'count_restaurants'
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    return {
      restaurants: restaurantsResult.rows,
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
    logger.error('Error obteniendo restaurantes paginados:', error);
    throw error;
  }
};

/**
 * Verifica si un slug está disponible
 * @param {string} slug - Slug a verificar
 * @param {string} excludeId - ID a excluir (para updates)
 * @returns {Promise<boolean>} True si está disponible
 */
const isSlugAvailable = async (slug, excludeId = null) => {
  try {
    let queryText = 'SELECT id FROM restaurants WHERE slug = $1';
    const values = [slug];

    if (excludeId) {
      queryText += ' AND id != $2';
      values.push(excludeId);
    }

    const result = await query(queryText, values, 'check_slug_availability');
    return result.rows.length === 0;
  } catch (error) {
    logger.error('Error verificando disponibilidad de slug:', error);
    throw error;
  }
};

/**
 * Obtiene estadísticas detalladas de un restaurante
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} dateRange - Rango de fechas opcional
 * @returns {Promise<Object>} Estadísticas completas
 */
const getRestaurantStats = async (restaurantId, dateRange = {}) => {
  const { startDate, endDate } = dateRange;
  
  let dateFilter = '';
  const baseValues = [restaurantId];
  let paramCount = 2;

  if (startDate && endDate) {
    dateFilter = `AND created_at BETWEEN $${paramCount} AND $${paramCount + 1}`;
    baseValues.push(startDate, endDate);
    paramCount += 2;
  }

  try {
    return await transaction(async (client) => {
      // Estadísticas de pedidos
      const orderStatsResult = await client.query(
        `SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(SUM(CASE WHEN status = 'delivered' THEN total END), 0) as delivered_revenue,
          COALESCE(AVG(total), 0) as avg_order_value,
          COUNT(DISTINCT customer_phone) as unique_customers,
          COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))/60), 0) as avg_delivery_time,
          
          -- Por método de pago
          COUNT(CASE WHEN payment_method = 'cash' THEN 1 END) as cash_orders,
          COUNT(CASE WHEN payment_method = 'card' THEN 1 END) as card_orders,
          COUNT(CASE WHEN payment_method = 'transfer' THEN 1 END) as transfer_orders
          
        FROM orders 
        WHERE restaurant_id = $1 ${dateFilter}`,
        baseValues
      );

      // Estadísticas de conversaciones
      const conversationStatsResult = await client.query(
        `SELECT 
          COUNT(*) as total_conversations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_conversations,
          COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned_conversations,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_conversations,
          COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(updated_at, NOW()) - created_at))/60), 0) as avg_conversation_duration
        FROM conversations 
        WHERE restaurant_id = $1 ${dateFilter}`,
        baseValues
      );

      // Estadísticas del menú
      const menuStatsResult = await client.query(
        `SELECT 
          COUNT(DISTINCT mc.id) as total_categories,
          COUNT(mi.id) as total_menu_items,
          COUNT(CASE WHEN mi.is_available THEN 1 END) as available_items,
          COUNT(CASE WHEN mi.image_url IS NOT NULL THEN 1 END) as items_with_images,
          COALESCE(AVG(mi.current_price), 0) as avg_item_price
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mc.id = mi.category_id
        WHERE mc.restaurant_id = $1`,
        [restaurantId]
      );

      // Items más vendidos (últimos 30 días)
      const topItemsResult = await client.query(
        `SELECT 
          oi.menu_item_name,
          SUM(oi.quantity) as total_sold,
          COUNT(DISTINCT oi.order_id) as order_count
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.restaurant_id = $1 
          AND o.status != 'cancelled'
          AND o.created_at > NOW() - INTERVAL '30 days'
        GROUP BY oi.menu_item_name
        ORDER BY total_sold DESC
        LIMIT 5`,
        [restaurantId]
      );

      // Horarios de mayor actividad
      const hourlyStatsResult = await client.query(
        `SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as order_count
        FROM orders
        WHERE restaurant_id = $1 
          AND status != 'cancelled'
          ${dateFilter}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour`,
        baseValues
      );

      const stats = {
        ...orderStatsResult.rows[0],
        ...conversationStatsResult.rows[0],
        ...menuStatsResult.rows[0],
        top_items: topItemsResult.rows,
        hourly_distribution: hourlyStatsResult.rows,
        generated_at: new Date().toISOString()
      };

      // Calcular tasas
      const totalOrders = parseInt(stats.total_orders);
      const totalConversations = parseInt(stats.total_conversations);

      stats.delivery_rate = totalOrders > 0 
        ? ((parseInt(stats.delivered_orders) / totalOrders) * 100).toFixed(2)
        : 0;

      stats.cancellation_rate = totalOrders > 0
        ? ((parseInt(stats.cancelled_orders) / totalOrders) * 100).toFixed(2)
        : 0;

      stats.conversion_rate = totalConversations > 0
        ? ((parseInt(stats.completed_conversations) / totalConversations) * 100).toFixed(2)
        : 0;

      return stats;
    });
  } catch (error) {
    logger.error('Error obteniendo estadísticas del restaurante:', error);
    throw error;
  }
};

/**
 * Obtiene zonas de entrega de un restaurante
 * @param {string} restaurantId - ID del restaurante
 * @returns {Promise<Array>} Zonas de entrega
 */
const getDeliveryZones = async (restaurantId) => {
  try {
    const result = await query(
      `SELECT * FROM delivery_zones 
       WHERE restaurant_id = $1 AND is_active = true
       ORDER BY zone_name`,
      [restaurantId],
      'get_delivery_zones'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo zonas de entrega:', error);
    throw error;
  }
};

/**
 * Crea una zona de entrega
 * @param {Object} zoneData - Datos de la zona
 * @returns {Promise<Object>} Zona creada
 */
const createDeliveryZone = async (zoneData) => {
  const {
    restaurantId,
    zoneName,
    postalCodes = [],
    neighborhoods = [],
    extraFee = 0.00
  } = zoneData;

  try {
    const result = await query(
      `INSERT INTO delivery_zones (
        id, restaurant_id, zone_name, postal_codes, 
        neighborhoods, extra_fee, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
      RETURNING *`,
      [
        uuidv4(),
        restaurantId,
        zoneName,
        postalCodes,
        neighborhoods,
        extraFee
      ],
      'create_delivery_zone'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error creando zona de entrega:', error);
    throw error;
  }
};

/**
 * Verifica si una dirección está en zona de entrega
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} address - Dirección a verificar
 * @returns {Promise<Object|null>} Zona encontrada o null
 */
const findDeliveryZoneForAddress = async (restaurantId, address) => {
  const { postalCode, neighborhood } = address;

  try {
    const result = await query(
      `SELECT * FROM delivery_zones
       WHERE restaurant_id = $1 
         AND is_active = true
         AND (
           $2 = ANY(postal_codes) 
           OR $3 ILIKE ANY(
             SELECT '%' || unnest(neighborhoods) || '%'
           )
         )
       ORDER BY extra_fee ASC
       LIMIT 1`,
      [restaurantId, postalCode, neighborhood],
      'find_delivery_zone'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error buscando zona de entrega:', error);
    throw error;
  }
};

/**
 * Obtiene configuración de WhatsApp de un restaurante
 * @param {string} restaurantId - ID del restaurante
 * @returns {Promise<Object|null>} Configuración de WhatsApp
 */
const getWhatsAppConfig = async (restaurantId) => {
  try {
    const result = await query(
      `SELECT 
        whatsapp_phone_id,
        whatsapp_token,
        twilio_phone_number,
        CASE 
          WHEN whatsapp_phone_id IS NOT NULL AND whatsapp_token IS NOT NULL THEN 'meta'
          WHEN twilio_phone_number IS NOT NULL THEN 'twilio'
          ELSE null
        END as provider
      FROM restaurants 
      WHERE id = $1`,
      [restaurantId],
      'get_whatsapp_config'
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error obteniendo configuración de WhatsApp:', error);
    throw error;
  }
};

/**
 * Actualiza configuración de WhatsApp
 * @param {string} restaurantId - ID del restaurante
 * @param {Object} config - Nueva configuración
 * @returns {Promise<Object>} Restaurante actualizado
 */
const updateWhatsAppConfig = async (restaurantId, config) => {
  const {
    whatsappPhoneId = null,
    whatsappToken = null,
    twilioPhoneNumber = null
  } = config;

  try {
    const result = await query(
      `UPDATE restaurants 
       SET whatsapp_phone_id = $1,
           whatsapp_token = $2,
           twilio_phone_number = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [whatsappPhoneId, whatsappToken, twilioPhoneNumber, restaurantId],
      'update_whatsapp_config'
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando configuración de WhatsApp:', error);
    throw error;
  }
};

/**
 * Obtiene restaurantes activos con sus configuraciones básicas
 * @returns {Promise<Array>} Lista de restaurantes activos
 */
const getActiveRestaurants = async () => {
  try {
    const result = await query(
      `SELECT 
        id, name, slug, phone, 
        opens_at, closes_at, is_active,
        whatsapp_phone_id, twilio_phone_number,
        CASE 
          WHEN is_active = false THEN 'inactive'
          WHEN CURRENT_TIME BETWEEN opens_at AND closes_at THEN 'open'
          ELSE 'closed'
        END as current_status
      FROM restaurants 
      WHERE is_active = true
      ORDER BY name`,
      [],
      'get_active_restaurants'
    );

    return result.rows;
  } catch (error) {
    logger.error('Error obteniendo restaurantes activos:', error);
    throw error;
  }
};

/**
 * Marca un restaurante como activo/inactivo
 * @param {string} restaurantId - ID del restaurante
 * @param {boolean} isActive - Nuevo estado
 * @returns {Promise<Object>} Restaurante actualizado
 */
const toggleRestaurantStatus = async (restaurantId, isActive) => {
  try {
    const result = await query(
      `UPDATE restaurants 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [isActive, restaurantId],
      'toggle_restaurant_status'
    );

    logger.info('Estado de restaurante actualizado', {
      restaurantId,
      newStatus: isActive ? 'active' : 'inactive'
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error actualizando estado del restaurante:', error);
    throw error;
  }
};

module.exports = {
  findBySlug,
  findById,
  createRestaurant,
  updateRestaurant,
  getRestaurantsPaginated,
  isSlugAvailable,
  getRestaurantStats,
  getDeliveryZones,
  createDeliveryZone,
  findDeliveryZoneForAddress,
  getWhatsAppConfig,
  updateWhatsAppConfig,
  getActiveRestaurants,
  toggleRestaurantStatus
};