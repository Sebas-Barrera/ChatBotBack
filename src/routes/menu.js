const express = require('express');
const MenuController = require('../controllers/menuController');
const AuthMiddleware = require('../middleware/auth');
const { apiTenantResolver, dashboardTenantResolver } = require('../middleware/tenantResolver');

const router = express.Router();

// ============================================
// RUTAS PÚBLICAS DEL MENÚ
// ============================================

/**
 * Obtiene el menú completo de un restaurante (público)
 * URL: GET /api/menu/restaurant/:restaurantId
 */
router.get('/restaurant/:restaurantId',
  MenuController.getFullMenu
);

/**
 * Obtiene un item específico del menú (público)
 * URL: GET /api/menu/item/:itemId
 */
router.get('/item/:itemId',
  MenuController.getMenuItem
);

/**
 * Busca items en el menú de un restaurante (público)
 * URL: GET /api/menu/restaurant/:restaurantId/search
 */
router.get('/restaurant/:restaurantId/search',
  MenuController.searchMenuItems
);

/**
 * Obtiene items populares de un restaurante (público)
 * URL: GET /api/menu/restaurant/:restaurantId/popular
 */
router.get('/restaurant/:restaurantId/popular',
  MenuController.getPopularItems
);

// ============================================
// RUTAS ADMINISTRATIVAS (REQUIEREN AUTENTICACIÓN)
// ============================================

// Middleware de autenticación para rutas administrativas
router.use(AuthMiddleware.authenticateToken);

// ============================================
// GESTIÓN DE CATEGORÍAS
// ============================================

/**
 * Obtiene categorías del restaurante actual
 * URL: GET /api/menu/categories
 */
router.get('/categories',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.getCategories
);

/**
 * Crea una nueva categoría
 * URL: POST /api/menu/categories
 */
router.post('/categories',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  MenuController.createCategory
);

/**
 * Actualiza una categoría
 * URL: PUT /api/menu/categories/:categoryId
 */
router.put('/categories/:categoryId',
  AuthMiddleware.requireRole(['admin', 'manager']),
  MenuController.updateCategory
);

// ============================================
// GESTIÓN DE ITEMS DEL MENÚ
// ============================================

/**
 * Obtiene el menú completo del restaurante actual
 * URL: GET /api/menu
 */
router.get('/',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.getFullMenu
);

/**
 * Obtiene resumen del menú del restaurante actual
 * URL: GET /api/menu/summary
 */
router.get('/summary',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.getMenuSummary
);

/**
 * Busca items en el menú del restaurante actual
 * URL: GET /api/menu/search
 */
router.get('/search',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.searchMenuItems
);

/**
 * Obtiene items populares del restaurante actual
 * URL: GET /api/menu/popular
 */
router.get('/popular',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.getPopularItems
);

/**
 * Crea un nuevo item del menú
 * URL: POST /api/menu/items
 */
router.post('/items',
  dashboardTenantResolver,
  AuthMiddleware.requireRole(['admin', 'manager']),
  AuthMiddleware.requireRestaurantAccess,
  MenuController.createMenuItem
);

/**
 * Obtiene un item específico del menú del restaurante actual
 * URL: GET /api/menu/items/:itemId
 */
router.get('/items/:itemId',
  dashboardTenantResolver,
  AuthMiddleware.requireRestaurantAccess,
  MenuController.getMenuItem
);

/**
 * Actualiza un item del menú
 * URL: PUT /api/menu/items/:itemId
 */
router.put('/items/:itemId',
  AuthMiddleware.requireRole(['admin', 'manager']),
  MenuController.updateMenuItem
);

/**
 * Cambia disponibilidad de un item
 * URL: PATCH /api/menu/items/:itemId/availability
 */
router.patch('/items/:itemId/availability',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  MenuController.toggleItemAvailability
);

/**
 * Elimina un item del menú
 * URL: DELETE /api/menu/items/:itemId
 */
router.delete('/items/:itemId',
  AuthMiddleware.requireRole(['admin', 'manager']),
  MenuController.deleteMenuItem
);

// ============================================
// OPERACIONES EN LOTE
// ============================================

/**
 * Actualiza orden de display de items
 * URL: PUT /api/menu/items/display-order
 */
router.put('/items/display-order',
  AuthMiddleware.requireRole(['admin', 'manager']),
  MenuController.updateDisplayOrder
);

/**
 * Actualización en lote de disponibilidad
 * URL: PATCH /api/menu/items/batch-availability
 */
router.patch('/items/batch-availability',
  AuthMiddleware.requireRole(['admin', 'manager', 'staff']),
  MenuController.batchUpdateAvailability
);

// ============================================
// RUTAS ESPECÍFICAS POR RESTAURANTE (PARA SUPER ADMIN)
// ============================================

/**
 * Obtiene categorías de un restaurante específico
 * URL: GET /api/menu/restaurant/:restaurantId/categories
 */
router.get('/restaurant/:restaurantId/categories',
  AuthMiddleware.requireRole('super_admin'),
  MenuController.getCategories
);

/**
 * Crea categoría en un restaurante específico
 * URL: POST /api/menu/restaurant/:restaurantId/categories
 */
router.post('/restaurant/:restaurantId/categories',
  AuthMiddleware.requireRole('super_admin'),
  MenuController.createCategory
);

/**
 * Crea item en un restaurante específico
 * URL: POST /api/menu/restaurant/:restaurantId/items
 */
router.post('/restaurant/:restaurantId/items',
  AuthMiddleware.requireRole('super_admin'),
  MenuController.createMenuItem
);

/**
 * Obtiene resumen del menú de un restaurante específico
 * URL: GET /api/menu/restaurant/:restaurantId/summary
 */
router.get('/restaurant/:restaurantId/summary',
  AuthMiddleware.requireRole('super_admin'),
  MenuController.getMenuSummary
);

module.exports = router;