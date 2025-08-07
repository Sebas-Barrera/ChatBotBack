const express = require('express');
const RestaurantController = require('../controllers/restaurantController');
const AuthMiddleware = require('../middleware/auth');
const { apiTenantResolver, dashboardTenantResolver } = require('../middleware/tenantResolver');

const router = express.Router();

// ============================================
// RUTAS PÚBLICAS
// ============================================

/**
 * Obtiene un restaurante por slug
 * URL: GET /api/restaurants/slug/:slug
 */
router.get('/slug/:slug',
  RestaurantController.getRestaurantBySlug
);

/**
 * Verifica disponibilidad de slug
 * URL: GET /api/restaurants/check-slug/:slug
 */
router.get('/check-slug/:slug',
  RestaurantController.checkSlugAvailability
);

// ============================================
// RUTAS ADMINISTRATIVAS (REQUIEREN AUTENTICACIÓN)
// ============================================

// Middleware de autenticación para rutas administrativas
router.use(AuthMiddleware.authenticateToken);

/**
 * Obtiene lista de restaurantes (solo super admin)
 * URL: GET /api/restaurants
 */
router.get('/',
  AuthMiddleware.requireRole('super_admin'),
  RestaurantController.getAllRestaurants
);

/**
 * Crea un nuevo restaurante (solo super admin)
 * URL: POST /api/restaurants
 */
router.post('/',
  AuthMiddleware.requireRole('super_admin'),
  RestaurantController.createRestaurant
);

/**
 * Obtiene un restaurante por ID (super admin o propietario)
 * URL: GET /api/restaurants/:id
 */
router.get('/:id',
  AuthMiddleware.requireRole(['super_admin', 'admin', 'manager']),
  RestaurantController.getRestaurantById
);

/**
 * Actualiza un restaurante (super admin o propietario)
 * URL: PUT /api/restaurants/:id
 */
router.put('/:id',
  AuthMiddleware.requireRole(['super_admin', 'admin']),
  RestaurantController.updateRestaurant
);

/**
 * Actualiza configuración de un restaurante
 * URL: PUT /api/restaurants/:id/settings
 */
router.put('/:id/settings',
  AuthMiddleware.requireRole(['super_admin', 'admin']),
  RestaurantController.updateRestaurantSettings
);

/**
 * Obtiene estadísticas de un restaurante
 * URL: GET /api/restaurants/:id/stats
 */
router.get('/:id/stats',
  AuthMiddleware.requireRole(['super_admin', 'admin', 'manager']),
  RestaurantController.getRestaurantStats
);

/**
 * Activa un restaurante (solo super admin)
 * URL: POST /api/restaurants/:id/activate
 */
router.post('/:id/activate',
  AuthMiddleware.requireRole('super_admin'),
  RestaurantController.activateRestaurant
);

/**
 * Desactiva un restaurante (solo super admin)
 * URL: POST /api/restaurants/:id/deactivate
 */
router.post('/:id/deactivate',
  AuthMiddleware.requireRole('super_admin'),
  RestaurantController.deactivateRestaurant
);

// ============================================
// RUTAS DEL RESTAURANTE ACTUAL
// ============================================

/**
 * Obtiene el restaurante actual (basado en el token/tenant)
 * URL: GET /api/restaurants/current
 */
router.get('/current',
  dashboardTenantResolver,
  RestaurantController.getCurrentRestaurant
);

/**
 * Actualiza el restaurante actual
 * URL: PUT /api/restaurants/current
 */
router.put('/current',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  RestaurantController.updateCurrentRestaurant
);

/**
 * Obtiene estadísticas del restaurante actual
 * URL: GET /api/restaurants/current/stats
 */
router.get('/current/stats',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  RestaurantController.getCurrentRestaurantStats
);

/**
 * Obtiene resumen del dashboard del restaurante actual
 * URL: GET /api/restaurants/current/dashboard
 */
router.get('/current/dashboard',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  AuthMiddleware.requireRestaurantAccess,
  RestaurantController.getDashboardSummary
);

module.exports = router;