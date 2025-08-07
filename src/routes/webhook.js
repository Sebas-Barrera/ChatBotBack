const express = require('express');
const WebhookController = require('../controllers/webhookController');
const { webhookTenantResolver } = require('../middleware/tenantResolver');
const { webhookLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ============================================
// RUTAS DE WEBHOOKS
// ============================================

// Aplicar rate limiting específico para webhooks
router.use(webhookLimiter);

// ============================================
// WEBHOOKS DE WHATSAPP
// ============================================

/**
 * Webhook genérico de WhatsApp
 * Maneja tanto Twilio como Meta WhatsApp
 * URL: /webhook/:restaurantSlug
 */
router.all('/:restaurantSlug', 
  webhookTenantResolver,
  WebhookController.handleWhatsAppWebhook
);

/**
 * Webhook específico de Twilio
 * URL: /webhook/twilio/:restaurantSlug
 */
router.post('/twilio/:restaurantSlug',
  webhookTenantResolver,
  WebhookController.handleTwilioWebhook
);

/**
 * Webhook específico de Meta WhatsApp
 * Maneja tanto GET (verificación) como POST (mensajes)
 * URL: /webhook/meta/:restaurantSlug
 */
router.all('/meta/:restaurantSlug',
  webhookTenantResolver,
  WebhookController.handleMetaWebhook
);

// ============================================
// WEBHOOKS DE PRUEBA Y DESARROLLO
// ============================================

/**
 * Webhook de prueba para desarrollo
 * URL: /webhook/test/:restaurantSlug
 */
router.post('/test/:restaurantSlug',
  webhookTenantResolver,
  WebhookController.handleTestWebhook
);

// ============================================
// OPERACIONES DE GESTIÓN
// ============================================

/**
 * Reinicia una conversación específica
 * URL: POST /webhook/restart/:restaurantSlug
 */
router.post('/restart/:restaurantSlug',
  webhookTenantResolver,
  WebhookController.restartConversation
);

/**
 * Envía mensaje manual desde el dashboard
 * URL: POST /webhook/send/:restaurantSlug
 */
router.post('/send/:restaurantSlug',
  webhookTenantResolver,
  WebhookController.sendManualMessage
);

// ============================================
// ESTADÍSTICAS Y MONITOREO
// ============================================

/**
 * Obtiene estadísticas de webhooks
 * URL: GET /webhook/stats
 */
router.get('/stats',
  WebhookController.getWebhookStats
);

module.exports = router;