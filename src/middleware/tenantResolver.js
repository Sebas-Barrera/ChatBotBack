const { query } = require('../config/database');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('./errorHandler');
const { VALIDATION_PATTERNS } = require('../utils/constants');

// ============================================
// CACHE DE RESTAURANTES
// ============================================

// Cache en memoria para evitar consultas repetitivas
const restaurantCache = new Map();
const cacheTimeout = 5 * 60 * 1000; // 5 minutos

/**
 * Limpia el cache de restaurantes
 */
const clearRestaurantCache = () => {
  restaurantCache.clear();
  logger.debug('Cache de restaurantes limpiado');
};

/**
 * Obtiene un restaurante del cache o base de datos
 * @param {string} key - Clave del cache (slug o phone)
 * @param {string} value - Valor a buscar
 * @param {string} field - Campo por el cual buscar
 * @returns {Promise<Object|null>} Datos del restaurante
 */
const getRestaurantFromCacheOrDB = async (key, value, field) => {
  // Verificar cache
  const cached = restaurantCache.get(key);
  if (cached && Date.now() - cached.timestamp < cacheTimeout) {
    logger.debug('Restaurante obtenido del cache', { key, field });
    return cached.data;
  }

  // Consultar base de datos
  try {
    const result = await query(
      `SELECT 
        r.id,
        r.name,
        r.slug,
        r.phone,
        r.email,
        r.is_active,
        r.opens_at,
        r.closes_at,
        r.delivery_time_min,
        r.delivery_time_max,
        r.delivery_fee,
        r.minimum_order,
        r.whatsapp_phone_id,
        r.twilio_phone_number,
        rs.claude_api_key,
        rs.claude_model,
        rs.ai_personality,
        rs.welcome_message,
        rs.goodbye_message,
        rs.error_message,
        rs.auto_confirm_orders,
        rs.max_conversation_time,
        rs.notification_email,
        rs.notification_phone
      FROM restaurants r
      LEFT JOIN restaurant_settings rs ON r.id = rs.restaurant_id
      WHERE r.${field} = $1 AND r.is_active = true`,
      [value],
      `get_restaurant_by_${field}`
    );

    const restaurant = result.rows[0] || null;

    // Guardar en cache
    if (restaurant) {
      restaurantCache.set(key, {
        data: restaurant,
        timestamp: Date.now()
      });
      logger.debug('Restaurante guardado en cache', { key, field });
    }

    return restaurant;
    
  } catch (error) {
    logger.error(`Error obteniendo restaurante por ${field}:`, error);
    throw error;
  }
};

// ============================================
// RESOLVERS DE TENANT
// ============================================

/**
 * Resuelve tenant por slug en la URL
 * Ejemplo: /webhook/hot-wings
 * @param {Object} req - Request object
 * @returns {Promise<Object|null>} Datos del restaurante
 */
const resolveBySlug = async (req) => {
  const slug = req.params.restaurantSlug || req.params.slug;
  
  if (!slug) {
    return null;
  }

  // Validar formato del slug
  if (!VALIDATION_PATTERNS.SLUG.test(slug)) {
    throw new ValidationError('Formato de slug inválido');
  }

  logger.debug('Resolviendo tenant por slug', { slug });
  
  const restaurant = await getRestaurantFromCacheOrDB(
    `slug:${slug}`, 
    slug, 
    'slug'
  );

  if (restaurant) {
    logger.debug('Tenant resuelto por slug', { 
      slug, 
      restaurantId: restaurant.id,
      restaurantName: restaurant.name 
    });
  }

  return restaurant;
};

/**
 * Resuelve tenant por número de WhatsApp
 * Para webhooks que llegan con número específico
 * @param {Object} req - Request object
 * @returns {Promise<Object|null>} Datos del restaurante
 */
const resolveByWhatsAppNumber = async (req) => {
  // Obtener número del webhook (Twilio format: whatsapp:+525512345678)
  let phoneNumber = req.body?.To || req.body?.to;
  
  if (!phoneNumber) {
    return null;
  }

  // Limpiar formato de Twilio
  if (phoneNumber.startsWith('whatsapp:')) {
    phoneNumber = phoneNumber.replace('whatsapp:', '');
  }

  logger.debug('Resolviendo tenant por número WhatsApp', { phoneNumber });

  // Buscar por twilio_phone_number
  let restaurant = await getRestaurantFromCacheOrDB(
    `twilio:${phoneNumber}`,
    phoneNumber,
    'twilio_phone_number'
  );

  // Si no se encuentra, buscar por phone principal
  if (!restaurant) {
    restaurant = await getRestaurantFromCacheOrDB(
      `phone:${phoneNumber}`,
      phoneNumber,
      'phone'
    );
  }

  if (restaurant) {
    logger.debug('Tenant resuelto por WhatsApp', { 
      phoneNumber, 
      restaurantId: restaurant.id,
      restaurantName: restaurant.name 
    });
  }

  return restaurant;
};

/**
 * Resuelve tenant por Meta WhatsApp Phone Number ID
 * @param {Object} req - Request object
 * @returns {Promise<Object|null>} Datos del restaurante
 */
const resolveByMetaPhoneId = async (req) => {
  const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  
  if (!phoneNumberId) {
    return null;
  }

  logger.debug('Resolviendo tenant por Meta Phone ID', { phoneNumberId });

  const restaurant = await getRestaurantFromCacheOrDB(
    `meta:${phoneNumberId}`,
    phoneNumberId,
    'whatsapp_phone_id'
  );

  if (restaurant) {
    logger.debug('Tenant resuelto por Meta WhatsApp', { 
      phoneNumberId, 
      restaurantId: restaurant.id,
      restaurantName: restaurant.name 
    });
  }

  return restaurant;
};

/**
 * Resuelve tenant por header personalizado
 * Para casos especiales o APIs internas
 * @param {Object} req - Request object
 * @returns {Promise<Object|null>} Datos del restaurante
 */
const resolveByHeader = async (req) => {
  const restaurantId = req.headers['x-restaurant-id'];
  const restaurantSlug = req.headers['x-restaurant-slug'];

  if (!restaurantId && !restaurantSlug) {
    return null;
  }

  logger.debug('Resolviendo tenant por header', { restaurantId, restaurantSlug });

  let restaurant = null;

  if (restaurantId) {
    restaurant = await getRestaurantFromCacheOrDB(
      `id:${restaurantId}`,
      restaurantId,
      'id'
    );
  } else if (restaurantSlug) {
    restaurant = await getRestaurantFromCacheOrDB(
      `slug:${restaurantSlug}`,
      restaurantSlug,
      'slug'
    );
  }

  if (restaurant) {
    logger.debug('Tenant resuelto por header', { 
      restaurantId: restaurant.id,
      restaurantName: restaurant.name 
    });
  }

  return restaurant;
};

// ============================================
// MIDDLEWARE PRINCIPAL
// ============================================

/**
 * Middleware principal para resolver tenant
 * Intenta diferentes métodos en orden de prioridad
 * @param {Object} options - Opciones de configuración
 * @returns {Function} Middleware function
 */
const tenantResolver = (options = {}) => {
  const {
    required = false,
    methods = ['slug', 'whatsapp', 'meta', 'header'],
    onNotFound = null,
    skipPaths = ['/health', '/']
  } = options;

  return async (req, res, next) => {
    try {
      // Saltar paths específicos
      if (skipPaths.includes(req.path)) {
        return next();
      }

      logger.debug('Iniciando resolución de tenant', {
        path: req.path,
        method: req.method,
        methods: methods
      });

      let restaurant = null;

      // Intentar diferentes métodos de resolución
      for (const method of methods) {
        switch (method) {
          case 'slug':
            restaurant = await resolveBySlug(req);
            break;
          case 'whatsapp':
            restaurant = await resolveByWhatsAppNumber(req);
            break;
          case 'meta':
            restaurant = await resolveByMetaPhoneId(req);
            break;
          case 'header':
            restaurant = await resolveByHeader(req);
            break;
          default:
            logger.warn('Método de resolución desconocido:', method);
        }

        if (restaurant) {
          break;
        }
      }

      // Verificar si el restaurante está activo
      if (restaurant && !restaurant.is_active) {
        logger.warn('Intento de acceso a restaurante inactivo', {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name
        });
        restaurant = null;
      }

      // Manejar caso de restaurante no encontrado
      if (!restaurant) {
        logger.warn('Tenant no resuelto', {
          path: req.path,
          method: req.method,
          body: req.body,
          params: req.params,
          headers: {
            'x-restaurant-id': req.headers['x-restaurant-id'],
            'x-restaurant-slug': req.headers['x-restaurant-slug']
          }
        });

        if (required) {
          if (onNotFound && typeof onNotFound === 'function') {
            return onNotFound(req, res, next);
          }
          
          throw new NotFoundError('Restaurante no encontrado o inactivo');
        }
      }

      // Agregar datos del restaurante al request
      if (restaurant) {
        req.restaurant = restaurant;
        req.restaurantId = restaurant.id;
        req.tenant = restaurant; // Alias para compatibilidad
        
        logger.info('Tenant resuelto exitosamente', {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          slug: restaurant.slug,
          path: req.path
        });

        // Agregar header de respuesta
        res.set('X-Restaurant-ID', restaurant.id);
        res.set('X-Restaurant-Name', restaurant.name);
      }

      next();

    } catch (error) {
      logger.error('Error en resolución de tenant:', error);
      next(error);
    }
  };
};

// ============================================
// MIDDLEWARES ESPECÍFICOS
// ============================================

/**
 * Middleware para webhooks que requiere tenant
 */
const webhookTenantResolver = tenantResolver({
  required: true,
  methods: ['slug', 'whatsapp', 'meta'],
  onNotFound: (req, res, next) => {
    // Para webhooks, devolver 200 para evitar reintentos
    res.status(200).json({
      success: false,
      message: 'Webhook recibido pero restaurante no encontrado'
    });
  }
});

/**
 * Middleware para API que requiere tenant
 */
const apiTenantResolver = tenantResolver({
  required: true,
  methods: ['header', 'slug'],
  skipPaths: ['/health', '/', '/api/docs']
});

/**
 * Middleware para dashboard que puede ser opcional
 */
const dashboardTenantResolver = tenantResolver({
  required: false,
  methods: ['header', 'slug'],
  skipPaths: ['/health', '/', '/api/docs', '/api/restaurants']
});

// ============================================
// UTILIDADES
// ============================================

/**
 * Obtiene datos completos del restaurante incluyendo menú y reglas
 * @param {string} restaurantId - ID del restaurante
 * @returns {Promise<Object>} Datos completos del restaurante
 */
const getFullRestaurantData = async (restaurantId) => {
  try {
    const cacheKey = `full:${restaurantId}`;
    const cached = restaurantCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < cacheTimeout) {
      return cached.data;
    }

    // Obtener datos base del restaurante
    const restaurantResult = await query(
      `SELECT * FROM restaurants WHERE id = $1 AND is_active = true`,
      [restaurantId],
      'get_full_restaurant_base'
    );

    if (restaurantResult.rows.length === 0) {
      return null;
    }

    const restaurant = restaurantResult.rows[0];

    // Obtener menú activo
    const menuResult = await query(
      `SELECT 
        mi.id, mi.name, mi.description, mi.price, mi.is_available,
        mi.preparation_time, mi.display_order, mi.image_url,
        mc.name as category_name, mc.emoji as category_emoji
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.restaurant_id = $1 AND mi.is_available = true
      ORDER BY mc.display_order, mi.display_order`,
      [restaurantId],
      'get_restaurant_menu'
    );

    // Obtener reglas de negocio
    const rulesResult = await query(
      `SELECT 
        id, menu_item_id, rule_type, rule_name, rule_config, ai_message_template
      FROM business_rules 
      WHERE restaurant_id = $1 AND is_active = true`,
      [restaurantId],
      'get_restaurant_rules'
    );

    const fullData = {
      ...restaurant,
      menu: menuResult.rows,
      business_rules: rulesResult.rows
    };

    // Guardar en cache
    restaurantCache.set(cacheKey, {
      data: fullData,
      timestamp: Date.now()
    });

    return fullData;

  } catch (error) {
    logger.error('Error obteniendo datos completos del restaurante:', error);
    throw error;
  }
};

/**
 * Valida si un restaurante está abierto en el horario actual
 * @param {Object} restaurant - Datos del restaurante
 * @returns {boolean} True si está abierto
 */
const isRestaurantOpen = (restaurant) => {
  if (!restaurant.opens_at || !restaurant.closes_at) {
    return true; // Si no hay horarios definidos, asumir abierto
  }

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 8); // HH:mm:ss

  const opensAt = restaurant.opens_at;
  const closesAt = restaurant.closes_at;

  // Manejar caso donde cierra después de medianoche
  if (closesAt < opensAt) {
    return currentTime >= opensAt || currentTime <= closesAt;
  }

  return currentTime >= opensAt && currentTime <= closesAt;
};

/**
 * Middleware que verifica horarios de operación
 */
const checkOperatingHours = (req, res, next) => {
  if (!req.restaurant) {
    return next();
  }

  if (!isRestaurantOpen(req.restaurant)) {
    logger.info('Intento de acceso fuera de horario', {
      restaurantId: req.restaurant.id,
      currentTime: new Date().toTimeString().slice(0, 8),
      opensAt: req.restaurant.opens_at,
      closesAt: req.restaurant.closes_at
    });

    // Para webhooks, responder con mensaje apropiado
    if (req.path.startsWith('/webhook')) {
      return res.status(200).json({
        success: true,
        message: 'Restaurante cerrado'
      });
    }

    return res.status(400).json({
      success: false,
      error: {
        type: 'restaurant_closed',
        message: `Restaurante cerrado. Horarios: ${req.restaurant.opens_at} - ${req.restaurant.closes_at}`
      }
    });
  }

  next();
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Middleware principal
  tenantResolver,
  
  // Middlewares específicos
  webhookTenantResolver,
  apiTenantResolver,
  dashboardTenantResolver,
  
  // Utilidades
  getFullRestaurantData,
  isRestaurantOpen,
  checkOperatingHours,
  clearRestaurantCache,
  
  // Resolvers individuales (para testing)
  resolveBySlug,
  resolveByWhatsAppNumber,
  resolveByMetaPhoneId,
  resolveByHeader
};