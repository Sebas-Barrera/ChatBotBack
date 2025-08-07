// ============================================
// CONSTANTES DEL SISTEMA - CHATBOT CHINGÓN
// ============================================

/**
 * Estados de conversación
 */
const CONVERSATION_STATUS = {
  ACTIVE: 'active',
  COMPLETING_ORDER: 'completing_order',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
};

/**
 * Pasos de la conversación
 */
const CONVERSATION_STEPS = {
  GREETING: 'greeting',
  ORDERING: 'ordering',
  CUSTOMIZING: 'customizing',
  REVIEWING: 'reviewing',
  ADDRESS: 'address',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed'
};

/**
 * Estados de pedidos
 */
const ORDER_STATUS = {
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

/**
 * Tipos de reglas de negocio
 */
const BUSINESS_RULE_TYPES = {
  SAUCE_LIMIT: 'sauce_limit',
  EXTRA_COST: 'extra_cost',
  COMBO_RULE: 'combo_rule',
  SIZE_OPTION: 'size_option',
  QUANTITY_LIMIT: 'quantity_limit',
  TIME_RESTRICTION: 'time_restriction',
  AVAILABILITY: 'availability'
};

/**
 * Tipos de customización
 */
const CUSTOMIZATION_TYPES = {
  SAUCE: 'sauce',
  EXTRA: 'extra',
  SIZE: 'size',
  PREPARATION: 'preparation',
  REMOVAL: 'removal'
};

/**
 * Proveedores de WhatsApp
 */
const WHATSAPP_PROVIDERS = {
  TWILIO: 'twilio',
  META: 'meta'
};

/**
 * Modelos de Claude AI disponibles
 */
const CLAUDE_MODELS = {
  SONNET_3_5: 'claude-3-5-sonnet-20241022',
  HAIKU_3: 'claude-3-haiku-20240307',
  OPUS_3: 'claude-3-opus-20240229'
};

/**
 * Niveles de log
 */
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

/**
 * Tipos de eventos de seguridad
 */
const SECURITY_EVENTS = {
  INVALID_WEBHOOK: 'invalid_webhook',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity'
};

/**
 * Configuración de tiempo
 */
const TIME_LIMITS = {
  MAX_CONVERSATION_TIME: parseInt(process.env.MAX_CONVERSATION_TIME) || 1800, // 30 minutos
  CONVERSATION_CLEANUP_INTERVAL: parseInt(process.env.CONVERSATION_CLEANUP_INTERVAL) || 3600, // 1 hora
  DEFAULT_DELIVERY_TIME_MIN: parseInt(process.env.DEFAULT_DELIVERY_TIME_MIN) || 25,
  DEFAULT_DELIVERY_TIME_MAX: parseInt(process.env.DEFAULT_DELIVERY_TIME_MAX) || 35,
  MESSAGE_TIMEOUT: 30000, // 30 segundos
  DATABASE_QUERY_TIMEOUT: 30000, // 30 segundos
  CLAUDE_REQUEST_TIMEOUT: 60000 // 60 segundos
};

/**
 * Límites de rate limiting
 */
const RATE_LIMITS = {
  WEBHOOK_PER_MINUTE: 100,
  API_PER_MINUTE: 60,
  CLAUDE_PER_MINUTE: 30,
  WHATSAPP_PER_MINUTE: 50
};

/**
 * Configuración de archivos y uploads
 */
const FILE_LIMITS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'text/plain'],
  MAX_MESSAGE_LENGTH: 4096
};

/**
 * Configuración de base de datos
 */
const DATABASE_LIMITS = {
  MAX_POOL_SIZE: parseInt(process.env.DB_POOL_MAX) || 10,
  MIN_POOL_SIZE: parseInt(process.env.DB_POOL_MIN) || 2,
  IDLE_TIMEOUT: parseInt(process.env.DB_IDLE_TIMEOUT) || 10000,
  CONNECTION_TIMEOUT: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000
};

/**
 * Mensajes predeterminados del sistema
 */
const DEFAULT_MESSAGES = {
  WELCOME: '¡Hola! 👋 Bienvenido a nuestro restaurante. ¿En qué puedo ayudarte hoy?',
  ERROR: 'Lo siento, tuve un problema técnico. ¿Podrías repetir tu mensaje?',
  GOODBYE: '¡Gracias por tu pedido! 🙏 Te esperamos pronto.',
  TIMEOUT: 'He notado que no has respondido en un tiempo. ¿Sigues ahí? Tu pedido sigue guardado.',
  INVALID_INPUT: 'No entendí tu mensaje. ¿Podrías ser más específico?',
  ORDER_CONFIRMED: '✅ ¡Pedido confirmado! Llegará en {delivery_time} minutos aproximadamente.',
  ORDER_CANCELLED: '❌ Pedido cancelado. ¿Hay algo más en lo que pueda ayudarte?',
  RESTAURANT_CLOSED: '😔 Lo siento, estamos cerrados en este momento. Nuestros horarios son: {hours}',
  OUT_OF_DELIVERY_ZONE: '📍 Lo siento, no hacemos entregas a esa zona. Nuestras zonas de entrega son: {zones}'
};

/**
 * Regex patterns para validación
 */
const VALIDATION_PATTERNS = {
  PHONE_NUMBER: /^\+[1-9]\d{1,14}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  MEXICAN_PHONE: /^(\+52|52)?[1-9]\d{9}$/,
  POSTAL_CODE: /^\d{5}$/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
};

/**
 * Configuración de Claude AI
 */
const CLAUDE_CONFIG = {
  DEFAULT_MODEL: process.env.CLAUDE_MODEL || CLAUDE_MODELS.SONNET_3_5,
  DEFAULT_MAX_TOKENS: parseInt(process.env.CLAUDE_MAX_TOKENS) || 500,
  DEFAULT_TEMPERATURE: parseFloat(process.env.CLAUDE_TEMPERATURE) || 0.7,
  MAX_CONTEXT_LENGTH: 100000, // tokens aproximados
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000 // 1 segundo
};

/**
 * Configuración de negocio
 */
const BUSINESS_CONFIG = {
  MIN_ORDER_AMOUNT: 50, // Monto mínimo de pedido por defecto
  MAX_ORDER_AMOUNT: 5000, // Monto máximo de pedido
  DEFAULT_DELIVERY_FEE: 0,
  MAX_ITEMS_PER_ORDER: 20,
  MAX_CUSTOMIZATIONS_PER_ITEM: 10,
  COMMISSION_RATE: 0.08, // 8% de comisión por defecto
  TAX_RATE: 0.16 // 16% IVA en México
};

/**
 * Configuración de cache
 */
const CACHE_CONFIG = {
  MENU_TTL: 300, // 5 minutos
  RESTAURANT_TTL: 600, // 10 minutos
  BUSINESS_RULES_TTL: 300, // 5 minutos
  CONVERSATION_TTL: 1800 // 30 minutos
};

/**
 * Configuración de notificaciones
 */
const NOTIFICATION_TYPES = {
  NEW_ORDER: 'new_order',
  ORDER_UPDATE: 'order_update',
  CUSTOMER_MESSAGE: 'customer_message',
  SYSTEM_ERROR: 'system_error',
  LOW_INVENTORY: 'low_inventory'
};

/**
 * Estados de disponibilidad
 */
const AVAILABILITY_STATUS = {
  AVAILABLE: 'available',
  OUT_OF_STOCK: 'out_of_stock',
  TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
  DISCONTINUED: 'discontinued'
};

/**
 * Tipos de descuento
 */
const DISCOUNT_TYPES = {
  PERCENTAGE: 'percentage',
  FIXED_AMOUNT: 'fixed_amount',
  FREE_ITEM: 'free_item',
  FREE_DELIVERY: 'free_delivery'
};

/**
 * Métodos de pago (para futuras implementaciones)
 */
const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  TRANSFER: 'transfer',
  DIGITAL_WALLET: 'digital_wallet'
};

/**
 * Días de la semana
 */
const WEEKDAYS = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 0
};

/**
 * Formatos de fecha y hora
 */
const DATE_FORMATS = {
  ISO: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  DATE_ONLY: 'YYYY-MM-DD',
  TIME_ONLY: 'HH:mm:ss',
  DISPLAY: 'DD/MM/YYYY HH:mm',
  SHORT_DATE: 'DD/MM/YYYY'
};

/**
 * Configuración de emojis para el chat
 */
const EMOJIS = {
  FOOD: {
    CHICKEN: '🍗',
    BURGER: '🍔',
    PIZZA: '🍕',
    TACO: '🌮',
    HOTDOG: '🌭',
    FRIES: '🍟'
  },
  DRINKS: {
    BEER: '🍺',
    SODA: '🥤',
    WATER: '💧',
    COFFEE: '☕',
    JUICE: '🧃'
  },
  STATUS: {
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    LOADING: '⏳',
    MONEY: '💰'
  },
  GENERAL: {
    HELLO: '👋',
    THANKS: '🙏',
    LOCATION: '📍',
    TIME: '⏰',
    PHONE: '📞',
    FIRE: '🔥'
  }
};

/**
 * Función helper para obtener emoji de comida
 * @param {string} category - Categoría del producto
 * @returns {string} Emoji correspondiente
 */
const getFoodEmoji = (category) => {
  const categoryLower = category.toLowerCase();
  
  if (categoryLower.includes('alit') || categoryLower.includes('pollo')) return EMOJIS.FOOD.CHICKEN;
  if (categoryLower.includes('hamburg')) return EMOJIS.FOOD.BURGER;
  if (categoryLower.includes('pizza')) return EMOJIS.FOOD.PIZZA;
  if (categoryLower.includes('taco')) return EMOJIS.FOOD.TACO;
  if (categoryLower.includes('hotdog') || categoryLower.includes('hot dog')) return EMOJIS.FOOD.HOTDOG;
  if (categoryLower.includes('papa') || categoryLower.includes('frita')) return EMOJIS.FOOD.FRIES;
  if (categoryLower.includes('bebida') || categoryLower.includes('refresco')) return EMOJIS.DRINKS.SODA;
  if (categoryLower.includes('cerveza') || categoryLower.includes('michela')) return EMOJIS.DRINKS.BEER;
  
  return '🍽️'; // Emoji por defecto
};

/**
 * Función helper para validar número de teléfono mexicano
 * @param {string} phone - Número de teléfono
 * @returns {boolean} True si es válido
 */
const isValidMexicanPhone = (phone) => {
  return VALIDATION_PATTERNS.MEXICAN_PHONE.test(phone);
};

/**
 * Función helper para formatear moneda mexicana
 * @param {number} amount - Cantidad
 * @returns {string} Cantidad formateada
 */
const formatMXNCurrency = (amount) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN'
  }).format(amount);
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Estados y tipos
  CONVERSATION_STATUS,
  CONVERSATION_STEPS,
  ORDER_STATUS,
  BUSINESS_RULE_TYPES,
  CUSTOMIZATION_TYPES,
  WHATSAPP_PROVIDERS,
  CLAUDE_MODELS,
  LOG_LEVELS,
  SECURITY_EVENTS,
  NOTIFICATION_TYPES,
  AVAILABILITY_STATUS,
  DISCOUNT_TYPES,
  PAYMENT_METHODS,
  
  // Configuración
  TIME_LIMITS,
  RATE_LIMITS,
  FILE_LIMITS,
  DATABASE_LIMITS,
  CLAUDE_CONFIG,
  BUSINESS_CONFIG,
  CACHE_CONFIG,
  
  // Mensajes y validación
  DEFAULT_MESSAGES,
  VALIDATION_PATTERNS,
  
  // Utilidades
  WEEKDAYS,
  DATE_FORMATS,
  EMOJIS,
  
  // Funciones helper
  getFoodEmoji,
  isValidMexicanPhone,
  formatMXNCurrency
};