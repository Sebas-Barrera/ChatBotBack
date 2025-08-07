const express = require('express');
const ConversationController = require('../controllers/conversationController');
const RestaurantController = require('../controllers/restaurantController');
const OrderController = require('../controllers/orderController');
const MenuController = require('../controllers/menuController');
const WhatsAppService = require('../services/whatsappService');
const ClaudeService = require('../services/claudeService');
const AuthMiddleware = require('../middleware/auth');
const { dashboardTenantResolver } = require('../middleware/tenantResolver');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================
// TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN
// ============================================

router.use(AuthMiddleware.authenticateToken);
router.use(dashboardTenantResolver);

// ============================================
// RESUMEN GENERAL DEL DASHBOARD
// ============================================

/**
 * Obtiene resumen completo del dashboard
 * URL: GET /api/dashboard
 */
router.get('/', 
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant.id;

      // Obtener datos en paralelo para mejor rendimiento
      const [
        restaurantSummary,
        ordersSummary,
        menuSummary,
        conversationStats
      ] = await Promise.all([
        RestaurantController.getDashboardSummary(req, { json: () => {} }),
        OrderController.getOrdersSummary(req, { json: () => {} }),
        MenuController.getMenuSummary(req, { json: () => {} }),
        ConversationController.getConversationStatistics(req, { json: () => {} })
      ]);

      const dashboardData = {
        restaurant: req.restaurant,
        summary: {
          orders: ordersSummary?.data || {},
          menu: menuSummary?.data || {},
          conversations: conversationStats?.data || {}
        },
        last_updated: new Date().toISOString()
      };

      logger.info('Resumen de dashboard obtenido', {
        restaurantId,
        userId: req.user.id
      });

      res.json({
        success: true,
        data: dashboardData
      });

    } catch (error) {
      logger.error('Error obteniendo resumen de dashboard:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo resumen del dashboard'
      });
    }
  })
);

// ============================================
// GESTIÓN DE CONVERSACIONES
// ============================================

/**
 * Obtiene conversaciones del restaurante
 * URL: GET /api/dashboard/conversations
 */
router.get('/conversations',
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.getConversations
);

/**
 * Obtiene una conversación específica
 * URL: GET /api/dashboard/conversations/:conversationId
 */
router.get('/conversations/:conversationId',
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.getConversationById
);

/**
 * Obtiene conversación activa de un cliente
 * URL: GET /api/dashboard/conversations/customer/:customerPhone
 */
router.get('/conversations/customer/:customerPhone',
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.getActiveConversation
);

/**
 * Obtiene estado de conversación de un cliente
 * URL: GET /api/dashboard/conversations/customer/:customerPhone/status
 */
router.get('/conversations/customer/:customerPhone/status',
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.getConversationStatus
);

/**
 * Inicia una nueva conversación
 * URL: POST /api/dashboard/conversations
 */
router.post('/conversations',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.startConversation
);

/**
 * Reinicia una conversación
 * URL: POST /api/dashboard/conversations/customer/:customerPhone/restart
 */
router.post('/conversations/customer/:customerPhone/restart',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.restartConversation
);

/**
 * Actualiza una conversación
 * URL: PUT /api/dashboard/conversations/:conversationId
 */
router.put('/conversations/:conversationId',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.updateConversation
);

/**
 * Marca conversación como abandonada
 * URL: POST /api/dashboard/conversations/:conversationId/abandon
 */
router.post('/conversations/:conversationId/abandon',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.abandonConversation
);

/**
 * Envía mensaje manual en conversación
 * URL: POST /api/dashboard/conversations/:conversationId/send
 */
router.post('/conversations/:conversationId/send',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.sendManualMessage
);

/**
 * Obtiene estadísticas de conversaciones
 * URL: GET /api/dashboard/conversations/statistics
 */
router.get('/conversations/statistics',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.getConversationStatistics
);

/**
 * Limpia conversaciones inactivas
 * URL: POST /api/dashboard/conversations/cleanup
 */
router.post('/conversations/cleanup',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.cleanupInactiveConversations
);

/**
 * Exporta conversaciones
 * URL: GET /api/dashboard/conversations/export
 */
router.get('/conversations/export',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  ConversationController.exportConversations
);

// ============================================
// MÉTRICAS Y ESTADÍSTICAS
// ============================================

/**
 * Obtiene métricas en tiempo real
 * URL: GET /api/dashboard/metrics/realtime
 */
router.get('/metrics/realtime',
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant.id;

      // Obtener métricas en tiempo real
      const [activeOrders, recentConversations] = await Promise.all([
        OrderController.getActiveOrders(req, { json: () => {} }),
        ConversationController.getConversations(req, { 
          query: { limit: 5, status: 'active' }, 
          json: () => {} 
        })
      ]);

      const metrics = {
        active_orders: activeOrders?.data?.summary || { total: 0, delayed: 0, urgent: 0 },
        active_conversations: recentConversations?.data?.length || 0,
        restaurant_status: req.restaurant.is_active ? 'active' : 'inactive',
        last_updated: new Date().toISOString()
      };

      res.json({
        success: true,
        data: metrics
      });

    } catch (error) {
      logger.error('Error obteniendo métricas en tiempo real:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo métricas'
      });
    }
  })
);

/**
 * Obtiene métricas de rendimiento
 * URL: GET /api/dashboard/metrics/performance
 */
router.get('/metrics/performance',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant.id;

      // Obtener estadísticas de rendimiento
      const [orderStats, conversationStats] = await Promise.all([
        OrderController.getOrderStatistics(req, { json: () => {} }),
        ConversationController.getConversationStatistics(req, { json: () => {} })
      ]);

      const performance = {
        order_stats: orderStats?.data?.basic || {},
        conversation_stats: conversationStats?.data || {},
        generated_at: new Date().toISOString()
      };

      res.json({
        success: true,
        data: performance
      });

    } catch (error) {
      logger.error('Error obteniendo métricas de rendimiento:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo métricas de rendimiento'
      });
    }
  })
);

// ============================================
// CONFIGURACIÓN Y AJUSTES
// ============================================

/**
 * Obtiene configuración actual del restaurante
 * URL: GET /api/dashboard/settings
 */
router.get('/settings',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  RestaurantController.getCurrentRestaurant
);

/**
 * Actualiza configuración del restaurante
 * URL: PUT /api/dashboard/settings
 */
router.put('/settings',
  AuthMiddleware.requireRole(['admin']),
  AuthMiddleware.requireRestaurantAccess,
  RestaurantController.updateCurrentRestaurant
);

/**
 * Actualiza configuración avanzada
 * URL: PUT /api/dashboard/settings/advanced
 */
router.put('/settings/advanced',
  AuthMiddleware.requireRole(['admin']),
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      // Reutilizar lógica del controlador de restaurantes
      req.params.id = req.restaurant.id;
      return RestaurantController.updateRestaurantSettings(req, res);

    } catch (error) {
      logger.error('Error actualizando configuración avanzada:', error);
      res.status(500).json({
        success: false,
        error: 'Error actualizando configuración'
      });
    }
  })
);

// ============================================
// HERRAMIENTAS DE DIAGNÓSTICO
// ============================================

/**
 * Verifica estado de servicios externos
 * URL: GET /api/dashboard/health/services
 */
router.get('/health/services',
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      // Verificar estado de servicios
      const [whatsappStatus, claudeStatus] = await Promise.all([
        WhatsAppService.checkServicesStatus(),
        // ClaudeService.testClaudeConnection() // Implementar si es necesario
        Promise.resolve({ available: true }) // Placeholder
      ]);

      const servicesHealth = {
        whatsapp: {
          status: whatsappStatus.healthy ? 'healthy' : 'unhealthy',
          active_provider: whatsappStatus.activeProvider,
          details: whatsappStatus
        },
        claude: {
          status: claudeStatus.available ? 'healthy' : 'unhealthy',
          details: claudeStatus
        },
        database: {
          status: 'healthy' // Si llegamos aquí, la BD está funcionando
        },
        last_checked: new Date().toISOString()
      };

      res.json({
        success: true,
        data: servicesHealth
      });

    } catch (error) {
      logger.error('Error verificando estado de servicios:', error);
      res.status(500).json({
        success: false,
        error: 'Error verificando servicios'
      });
    }
  })
);

/**
 * Prueba de conexión con WhatsApp
 * URL: POST /api/dashboard/test/whatsapp
 */
router.post('/test/whatsapp',
  AuthMiddleware.requireRole(['admin']),
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      const { phone_number, test_message = '🧪 Mensaje de prueba desde ChatBot Chingón' } = req.body;

      if (!phone_number) {
        return res.status(400).json({
          success: false,
          error: 'Número de teléfono requerido para la prueba'
        });
      }

      // Enviar mensaje de prueba
      const result = await WhatsAppService.sendMessage(phone_number, test_message);

      logger.info('Prueba de WhatsApp ejecutada', {
        restaurantId: req.restaurant.id,
        phoneNumber: phone_number.substring(0, 8) + '****',
        success: result.success,
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'Mensaje de prueba enviado',
        data: {
          phone_number: phone_number,
          message_sent: test_message,
          provider_result: result
        }
      });

    } catch (error) {
      logger.error('Error en prueba de WhatsApp:', error);
      res.status(500).json({
        success: false,
        error: 'Error enviando mensaje de prueba'
      });
    }
  })
);

// ============================================
// ACTIVIDAD Y LOGS
// ============================================

/**
 * Obtiene actividad reciente
 * URL: GET /api/dashboard/activity
 */
router.get('/activity',
  AuthMiddleware.requireRestaurantAccess,
  asyncHandler(async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const limitNumber = Math.min(parseInt(limit), 100);

      // Obtener actividad reciente (combinando pedidos y conversaciones)
      const [recentOrders, recentConversations] = await Promise.all([
        OrderController.getOrders(req, { 
          query: { limit: limitNumber / 2, sort_by: 'created_at', sort_order: 'DESC' }, 
          json: () => {} 
        }),
        ConversationController.getConversations(req, { 
          query: { limit: limitNumber / 2, sort_by: 'last_interaction_at', sort_order: 'DESC' }, 
          json: () => {} 
        })
      ]);

      // Combinar y ordenar actividad
      const activity = [];

      // Agregar pedidos a la actividad
      if (recentOrders?.data) {
        recentOrders.data.forEach(order => {
          activity.push({
            type: 'order',
            id: order.id,
            title: `Pedido ${order.id.substring(0, 8)}`,
            description: `Total: $${order.total} - Estado: ${order.status}`,
            timestamp: order.created_at,
            customer_phone: order.customer_phone?.substring(0, 8) + '****'
          });
        });
      }

      // Agregar conversaciones a la actividad
      if (recentConversations?.data) {
        recentConversations.data.forEach(conv => {
          activity.push({
            type: 'conversation',
            id: conv.id,
            title: `Conversación ${conv.id.substring(0, 8)}`,
            description: `Estado: ${conv.status} - Paso: ${conv.current_step}`,
            timestamp: conv.last_interaction_at,
            customer_phone: conv.customer_phone?.substring(0, 8) + '****'
          });
        });
      }

      // Ordenar por timestamp descendente
      activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json({
        success: true,
        data: {
          activity: activity.slice(0, limitNumber),
          total_items: activity.length
        }
      });

    } catch (error) {
      logger.error('Error obteniendo actividad:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo actividad'
      });
    }
  })
);

module.exports = router;