const Menu = require('../models/Menu');
const ValidationService = require('../services/validationService');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// CONTROLADOR DE MENÚ
// ============================================

class MenuController {

  // ============================================
  // CATEGORÍAS
  // ============================================

  /**
   * Obtiene todas las categorías de un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getCategories = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!ValidationService.isValidUUID(restaurantId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante inválido'
        });
      }

      const { active_only = 'true' } = req.query;
      const activeOnly = active_only === 'true';

      const categories = await Menu.getCategories(restaurantId, activeOnly);

      logger.info('Categorías de menú obtenidas', {
        restaurantId,
        categoriesCount: categories.length,
        activeOnly
      });

      res.json({
        success: true,
        data: categories
      });

    } catch (error) {
      logger.error('Error obteniendo categorías de menú:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo categorías'
      });
    }
  });

  /**
   * Crea una nueva categoría
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static createCategory = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar datos de entrada
      const validation = ValidationService.validateMenuCategoryCreation(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      const categoryData = validation.data;

      // Crear categoría
      const category = await Menu.createCategory(restaurantId, categoryData);

      logger.info('Categoría de menú creada', {
        restaurantId,
        categoryId: category.id,
        name: category.name
      });

      res.status(201).json({
        success: true,
        message: 'Categoría creada exitosamente',
        data: category
      });

    } catch (error) {
      logger.error('Error creando categoría de menú:', error);
      
      if (error.message.includes('ya existe')) {
        res.status(409).json({
          success: false,
          error: 'Ya existe una categoría con ese nombre'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error creando categoría'
        });
      }
    }
  });

  /**
   * Actualiza una categoría
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateCategory = asyncHandler(async (req, res) => {
    try {
      const { categoryId } = req.params;

      if (!ValidationService.isValidUUID(categoryId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de categoría inválido'
        });
      }

      // Validar que hay datos para actualizar
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No hay datos para actualizar'
        });
      }

      const updateData = req.body;

      // Validar campos específicos si están presentes
      const allowedFields = ['name', 'description', 'display_order', 'emoji', 'is_active'];
      const filteredData = {};

      Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredData[key] = updateData[key];
        }
      });

      if (Object.keys(filteredData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No hay campos válidos para actualizar'
        });
      }

      // Actualizar categoría
      const updatedCategory = await Menu.updateCategory(categoryId, filteredData);

      logger.info('Categoría actualizada', {
        categoryId,
        updatedFields: Object.keys(filteredData)
      });

      res.json({
        success: true,
        message: 'Categoría actualizada exitosamente',
        data: updatedCategory
      });

    } catch (error) {
      logger.error('Error actualizando categoría:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Categoría no encontrada'
        });
      } else if (error.message.includes('ya existe')) {
        res.status(409).json({
          success: false,
          error: 'Ya existe una categoría con ese nombre'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error actualizando categoría'
        });
      }
    }
  });

  // ============================================
  // MENÚ COMPLETO
  // ============================================

  /**
   * Obtiene el menú completo de un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getFullMenu = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      if (!ValidationService.isValidUUID(restaurantId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante inválido'
        });
      }

      const { available_only = 'true' } = req.query;
      const availableOnly = available_only === 'true';

      const menu = await Menu.getFullMenu(restaurantId, availableOnly);

      logger.info('Menú completo obtenido', {
        restaurantId,
        categoriesCount: menu.categories.length,
        totalItems: menu.total_items,
        availableOnly
      });

      res.json({
        success: true,
        data: menu
      });

    } catch (error) {
      logger.error('Error obteniendo menú completo:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo menú'
      });
    }
  });

  // ============================================
  // ITEMS DEL MENÚ
  // ============================================

  /**
   * Obtiene un item específico del menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getMenuItem = asyncHandler(async (req, res) => {
    try {
      const { itemId } = req.params;
      const restaurantId = req.restaurant?.id;

      if (!ValidationService.isValidUUID(itemId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de item inválido'
        });
      }

      const item = await Menu.getItem(itemId, restaurantId);

      if (!item) {
        return res.status(404).json({
          success: false,
          error: 'Item no encontrado'
        });
      }

      logger.info('Item de menú obtenido', {
        itemId,
        itemName: item.name,
        restaurantId: restaurantId || 'any'
      });

      res.json({
        success: true,
        data: item
      });

    } catch (error) {
      logger.error('Error obteniendo item de menú:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo item'
      });
    }
  });

  /**
   * Crea un nuevo item del menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static createMenuItem = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar datos de entrada
      const validation = ValidationService.validateMenuItemCreation(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      const itemData = validation.data;

      // Crear item
      const item = await Menu.createItem(restaurantId, itemData);

      logger.info('Item de menú creado', {
        restaurantId,
        itemId: item.id,
        name: item.name,
        price: item.price
      });

      res.status(201).json({
        success: true,
        message: 'Item creado exitosamente',
        data: item
      });

    } catch (error) {
      logger.error('Error creando item de menú:', error);
      
      if (error.message.includes('no pertenece')) {
        res.status(400).json({
          success: false,
          error: 'La categoría no pertenece a este restaurante'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error creando item'
        });
      }
    }
  });

  /**
   * Actualiza un item del menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateMenuItem = asyncHandler(async (req, res) => {
    try {
      const { itemId } = req.params;

      if (!ValidationService.isValidUUID(itemId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de item inválido'
        });
      }

      // Validar datos de actualización
      const validation = ValidationService.validateMenuItemUpdate(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      const updateData = validation.data;

      // Actualizar item
      const updatedItem = await Menu.updateItem(itemId, updateData);

      logger.info('Item de menú actualizado', {
        itemId,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        message: 'Item actualizado exitosamente',
        data: updatedItem
      });

    } catch (error) {
      logger.error('Error actualizando item de menú:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Item no encontrado'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error actualizando item'
        });
      }
    }
  });

  /**
   * Cambia la disponibilidad de un item
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static toggleItemAvailability = asyncHandler(async (req, res) => {
    try {
      const { itemId } = req.params;
      const { is_available } = req.body;

      if (!ValidationService.isValidUUID(itemId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de item inválido'
        });
      }

      if (typeof is_available !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'is_available debe ser booleano'
        });
      }

      // Actualizar disponibilidad
      const success = await Menu.setItemAvailability(itemId, is_available);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Item no encontrado'
        });
      }

      logger.info('Disponibilidad de item actualizada', {
        itemId,
        isAvailable: is_available
      });

      res.json({
        success: true,
        message: `Item ${is_available ? 'activado' : 'desactivado'} exitosamente`,
        data: {
          item_id: itemId,
          is_available
        }
      });

    } catch (error) {
      logger.error('Error cambiando disponibilidad de item:', error);
      res.status(500).json({
        success: false,
        error: 'Error actualizando disponibilidad'
      });
    }
  });

  /**
   * Elimina un item del menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static deleteMenuItem = asyncHandler(async (req, res) => {
    try {
      const { itemId } = req.params;

      if (!ValidationService.isValidUUID(itemId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de item inválido'
        });
      }

      // Eliminar item (soft delete si tiene pedidos asociados)
      const success = await Menu.deleteItem(itemId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Item no encontrado'
        });
      }

      logger.info('Item de menú eliminado', { itemId });

      res.json({
        success: true,
        message: 'Item eliminado exitosamente'
      });

    } catch (error) {
      logger.error('Error eliminando item de menú:', error);
      res.status(500).json({
        success: false,
        error: 'Error eliminando item'
      });
    }
  });

  // ============================================
  // BÚSQUEDA Y FILTROS
  // ============================================

  /**
   * Busca items en el menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static searchMenuItems = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      const {
        q: searchTerm = '',
        category_id = null,
        min_price = null,
        max_price = null,
        available_only = 'true'
      } = req.query;

      // Validar parámetros
      if (category_id && !ValidationService.isValidUUID(category_id)) {
        return res.status(400).json({
          success: false,
          error: 'ID de categoría inválido'
        });
      }

      const filters = {
        categoryId: category_id,
        minPrice: min_price ? parseFloat(min_price) : null,
        maxPrice: max_price ? parseFloat(max_price) : null,
        availableOnly: available_only === 'true'
      };

      // Realizar búsqueda
      const items = await Menu.searchItems(restaurantId, searchTerm, filters);

      logger.info('Búsqueda de items realizada', {
        restaurantId,
        searchTerm,
        filtersApplied: Object.keys(filters).filter(key => filters[key] !== null).length,
        resultsCount: items.length
      });

      res.json({
        success: true,
        data: {
          items,
          search_term: searchTerm,
          filters_applied: filters,
          results_count: items.length
        }
      });

    } catch (error) {
      logger.error('Error buscando items de menú:', error);
      res.status(500).json({
        success: false,
        error: 'Error realizando búsqueda'
      });
    }
  });

  /**
   * Obtiene items más populares
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getPopularItems = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      const { limit = 10 } = req.query;
      const limitNumber = parseInt(limit);

      if (limitNumber < 1 || limitNumber > 50) {
        return res.status(400).json({
          success: false,
          error: 'Límite debe estar entre 1 y 50'
        });
      }

      const popularItems = await Menu.getPopularItems(restaurantId, limitNumber);

      logger.info('Items populares obtenidos', {
        restaurantId,
        limit: limitNumber,
        itemsFound: popularItems.length
      });

      res.json({
        success: true,
        data: {
          items: popularItems,
          limit: limitNumber,
          generated_at: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Error obteniendo items populares:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo items populares'
      });
    }
  });

  // ============================================
  // OPERACIONES EN LOTE
  // ============================================

  /**
   * Actualiza orden de display de items
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateDisplayOrder = asyncHandler(async (req, res) => {
    try {
      const { updates } = req.body;

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Se requiere un array de actualizaciones'
        });
      }

      // Validar estructura de actualizaciones
      for (const update of updates) {
        if (!update.id || !ValidationService.isValidUUID(update.id)) {
          return res.status(400).json({
            success: false,
            error: 'ID inválido en actualizaciones'
          });
        }

        if (typeof update.display_order !== 'number' || update.display_order < 0) {
          return res.status(400).json({
            success: false,
            error: 'display_order debe ser un número no negativo'
          });
        }
      }

      // Actualizar orden
      const success = await Menu.updateDisplayOrder(updates);

      if (!success) {
        return res.status(500).json({
          success: false,
          error: 'Error actualizando orden'
        });
      }

      logger.info('Orden de display actualizado', {
        updatesCount: updates.length
      });

      res.json({
        success: true,
        message: 'Orden actualizado exitosamente',
        data: {
          updated_items: updates.length
        }
      });

    } catch (error) {
      logger.error('Error actualizando orden de display:', error);
      res.status(500).json({
        success: false,
        error: 'Error actualizando orden'
      });
    }
  });

  /**
   * Operación en lote para cambiar disponibilidad
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static batchUpdateAvailability = asyncHandler(async (req, res) => {
    try {
      const { item_ids, is_available } = req.body;

      if (!Array.isArray(item_ids) || item_ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Se requiere un array de IDs de items'
        });
      }

      if (typeof is_available !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'is_available debe ser booleano'
        });
      }

      // Validar IDs
      for (const itemId of item_ids) {
        if (!ValidationService.isValidUUID(itemId)) {
          return res.status(400).json({
            success: false,
            error: `ID inválido: ${itemId}`
          });
        }
      }

      // Actualizar disponibilidad de cada item
      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const itemId of item_ids) {
        try {
          const success = await Menu.setItemAvailability(itemId, is_available);
          results.push({ item_id: itemId, success });
          if (success) successCount++;
          else errorCount++;
        } catch (error) {
          results.push({ item_id: itemId, success: false, error: error.message });
          errorCount++;
        }
      }

      logger.info('Actualización en lote de disponibilidad completada', {
        totalItems: item_ids.length,
        successCount,
        errorCount,
        isAvailable: is_available
      });

      res.json({
        success: true,
        message: `Disponibilidad actualizada: ${successCount} exitosos, ${errorCount} errores`,
        data: {
          results,
          summary: {
            total: item_ids.length,
            successful: successCount,
            failed: errorCount
          }
        }
      });

    } catch (error) {
      logger.error('Error en actualización en lote:', error);
      res.status(500).json({
        success: false,
        error: 'Error en actualización en lote'
      });
    }
  });

  // ============================================
  // UTILIDADES
  // ============================================

  /**
   * Obtiene resumen del menú
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getMenuSummary = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Obtener categorías y items populares
      const [categories, popularItems] = await Promise.all([
        Menu.getCategories(restaurantId, true),
        Menu.getPopularItems(restaurantId, 5)
      ]);

      const totalItems = categories.reduce((sum, cat) => sum + parseInt(cat.items_count), 0);
      const totalCategories = categories.length;

      const summary = {
        restaurant_id: restaurantId,
        total_categories: totalCategories,
        total_items: totalItems,
        categories: categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          emoji: cat.emoji,
          items_count: cat.items_count
        })),
        popular_items: popularItems.slice(0, 5),
        generated_at: new Date().toISOString()
      };

      res.json({
        success: true,
        data: summary
      });

    } catch (error) {
      logger.error('Error obteniendo resumen del menú:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo resumen'
      });
    }
  });
}

module.exports = MenuController;