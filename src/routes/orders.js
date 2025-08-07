const express = require('express');
const OrderController = require('../controllers/orderController');
const AuthMiddleware = require('../middleware/auth');
const { dashboardTenantResolver } = require('../middleware/tenantResolver');

const router = express.Router();

// ============================================
// TODAS LAS RUTAS REQUIEREN AUTENTICACIÓN
// ============================================

router.use(AuthMiddleware.authenticateToken);

// ============================================
// RUTAS DEL RESTAURANTE ACTUAL
// ============================================

/**
 * Obtiene pedidos del restaurante actual
 * URL: GET /api/orders
 */
router.get('/',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getOrders
);

/**
 * Obtiene resumen de pedidos del restaurante actual
 * URL: GET /api/orders/summary
 */
router.get('/summary',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getOrdersSummary
);

/**
 * Obtiene pedidos activos del restaurante actual
 * URL: GET /api/orders/active
 */
router.get('/active',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getActiveOrders
);

/**
 * Busca pedidos del restaurante actual
 * URL: GET /api/orders/search
 */
router.get('/search',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.searchOrders
);

/**
 * Obtiene estadísticas de pedidos del restaurante actual
 * URL: GET /api/orders/statistics
 */
router.get('/statistics',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getOrderStatistics
);

/**
 * Genera reporte de ventas del restaurante actual
 * URL: GET /api/orders/reports/sales
 */
router.get('/reports/sales',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  OrderController.generateSalesReport
);

/**
 * Crea un nuevo pedido manual
 * URL: POST /api/orders
 */
router.post('/',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  OrderController.createOrder
);

/**
 * Actualización en lote de pedidos
 * URL: PATCH /api/orders/batch
 */
router.patch('/batch',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  OrderController.batchUpdateOrders
);

// ============================================
// RUTAS DE PEDIDOS ESPECÍFICOS
// ============================================

/**
 * Obtiene un pedido específico
 * URL: GET /api/orders/:orderId
 */
router.get('/:orderId',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getOrderById
);

/**
 * Actualiza el estado de un pedido
 * URL: PATCH /api/orders/:orderId/status
 */
router.patch('/:orderId/status',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  OrderController.updateOrderStatus
);

/**
 * Cancela un pedido
 * URL: POST /api/orders/:orderId/cancel
 */
router.post('/:orderId/cancel',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  OrderController.cancelOrder
);

/**
 * Valida si un pedido puede ser modificado
 * URL: GET /api/orders/:orderId/validate-modification
 */
router.get('/:orderId/validate-modification',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  OrderController.validateOrderModification
);

// ============================================
// RUTAS POR CLIENTE
// ============================================

/**
 * Obtiene pedidos de un cliente específico
 * URL: GET /api/orders/customer/:customerPhone
 */
router.get('/customer/:customerPhone',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  OrderController.getCustomerOrders
);

// ============================================
// RUTAS ESPECÍFICAS POR RESTAURANTE (PARA SUPER ADMIN)
// ============================================

/**
 * Obtiene pedidos de un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId
 */
router.get('/restaurant/:restaurantId',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.getOrders
);

/**
 * Obtiene pedidos activos de un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId/active
 */
router.get('/restaurant/:restaurantId/active',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.getActiveOrders
);

/**
 * Obtiene estadísticas de un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId/statistics
 */
router.get('/restaurant/:restaurantId/statistics',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.getOrderStatistics
);

/**
 * Genera reporte de ventas de un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId/reports/sales
 */
router.get('/restaurant/:restaurantId/reports/sales',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.generateSalesReport
);

/**
 * Busca pedidos en un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId/search
 */
router.get('/restaurant/:restaurantId/search',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.searchOrders
);

/**
 * Obtiene resumen de pedidos de un restaurante específico
 * URL: GET /api/orders/restaurant/:restaurantId/summary
 */
router.get('/restaurant/:restaurantId/summary',
  AuthMiddleware.requireRole('super_admin'),
  OrderController.getOrdersSummary
);

module.exports = router;