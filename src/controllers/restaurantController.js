const Restaurant = require("../models/Restaurant");
const ValidationService = require("../services/validationService");
const logger = require("../utils/logger");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================
// CONTROLADOR DE RESTAURANTES
// ============================================

class RestaurantController {
  /**
   * Obtiene lista de restaurantes con paginación
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getAllRestaurants = asyncHandler(async (req, res) => {
    try {
      // Validar parámetros de consulta
      const paginationValidation = ValidationService.validatePaginationParams(
        req.query
      );
      if (!paginationValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: paginationValidation.error,
        });
      }

      const { page, limit, sort_by, sort_order } = paginationValidation.data;

      const { search = "", is_active = null } = req.query;

      // Obtener restaurantes
      const result = await Restaurant.findAll({
        page,
        limit,
        search,
        isActive: is_active !== null ? is_active === "true" : null,
        sortBy: sort_by,
        sortOrder: sort_order,
      });

      logger.info("Lista de restaurantes obtenida", {
        page,
        limit,
        total: result.pagination.total_items,
        search: search || "none",
      });

      res.json({
        success: true,
        data: result.restaurants,
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error("Error obteniendo lista de restaurantes:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo restaurantes",
      });
    }
  });

  /**
   * Obtiene un restaurante por ID
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getRestaurantById = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      const restaurant = await Restaurant.findById(id);

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      }

      logger.info("Restaurante obtenido por ID", {
        restaurantId: id,
        restaurantName: restaurant.name,
      });

      res.json({
        success: true,
        data: restaurant,
      });
    } catch (error) {
      logger.error("Error obteniendo restaurante por ID:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo restaurante",
      });
    }
  });

  /**
   * Obtiene un restaurante por slug
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getRestaurantBySlug = asyncHandler(async (req, res) => {
    try {
      const { slug } = req.params;

      if (!slug || slug.length < 2) {
        return res.status(400).json({
          success: false,
          error: "Slug inválido",
        });
      }

      const restaurant = await Restaurant.findBySlug(slug);

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      }

      logger.info("Restaurante obtenido por slug", {
        slug,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
      });

      res.json({
        success: true,
        data: restaurant,
      });
    } catch (error) {
      logger.error("Error obteniendo restaurante por slug:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo restaurante",
      });
    }
  });

  /**
   * Crea un nuevo restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static createRestaurant = asyncHandler(async (req, res) => {
  try {
    console.log('📥 1. Datos recibidos en backend:', JSON.stringify(req.body, null, 2));

    // ✅ USAR VALIDACIÓN DE JOI
    const validation = ValidationService.validateRestaurantCreation(req.body);
    if (!validation.isValid) {
      console.log('❌ Error de validación:', validation.error);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    console.log('✅ Validación de Joi pasada');

    const restaurantData = validation.data;

    console.log('📊 2. Datos validados:', JSON.stringify(restaurantData, null, 2));

    // Verificar slug disponible
    console.log('🔍 3. Verificando disponibilidad de slug...');
    const isSlugAvailable = await Restaurant.isSlugAvailable(restaurantData.slug);
    console.log('📝 4. Slug disponible:', isSlugAvailable);
    
    if (!isSlugAvailable) {
      console.log('❌ Slug no disponible');
      return res.status(409).json({
        success: false,
        error: 'El slug ya está en uso'
      });
    }

    console.log('✅ 5. Slug disponible, creando restaurante...');

    // Crear restaurante
    const restaurant = await Restaurant.create(restaurantData);

    console.log('✅ 6. Restaurante creado exitosamente:', restaurant);

    res.status(201).json({
      success: true,
      message: 'Restaurante creado exitosamente',
      data: restaurant
    });

  } catch (error) {
    console.error('🔴 ERROR COMPLETO:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    res.status(500).json({
      success: false,
      error: 'Error creando restaurante: ' + error.message
    });
  }
});

  /**
   * Actualiza un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateRestaurant = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      // Validar datos de actualización
      const validation = ValidationService.validateRestaurantUpdate(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error,
        });
      }

      const updateData = validation.data;

      // Si se está actualizando el slug, verificar disponibilidad
      if (updateData.slug) {
        const isSlugAvailable = await Restaurant.isSlugAvailable(
          updateData.slug,
          id
        );
        if (!isSlugAvailable) {
          return res.status(409).json({
            success: false,
            error: "El slug ya está en uso",
          });
        }
      }

      // Actualizar restaurante
      const updatedRestaurant = await Restaurant.update(id, updateData);

      logger.info("Restaurante actualizado", {
        restaurantId: id,
        updatedFields: Object.keys(updateData),
      });

      res.json({
        success: true,
        message: "Restaurante actualizado exitosamente",
        data: updatedRestaurant,
      });
    } catch (error) {
      logger.error("Error actualizando restaurante:", error);

      if (error.message.includes("no encontrado")) {
        res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      } else if (error.message.includes("ya está en uso")) {
        res.status(409).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Error actualizando restaurante",
        });
      }
    }
  });

  /**
   * Actualiza configuración de un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateRestaurantSettings = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      const {
        claude_api_key,
        claude_model,
        ai_personality,
        welcome_message,
        goodbye_message,
        error_message,
        auto_confirm_orders,
        require_phone_validation,
        max_conversation_time,
        notification_email,
        notification_phone,
      } = req.body;

      // Validar campos específicos si están presentes
      if (
        notification_email &&
        !ValidationService.isValidEmail(notification_email)
      ) {
        return res.status(400).json({
          success: false,
          error: "Email de notificación inválido",
        });
      }

      if (
        notification_phone &&
        !ValidationService.isValidMexicanPhone(notification_phone)
      ) {
        return res.status(400).json({
          success: false,
          error: "Teléfono de notificación inválido",
        });
      }

      const settingsData = {
        claude_api_key,
        claude_model,
        ai_personality,
        welcome_message,
        goodbye_message,
        error_message,
        auto_confirm_orders,
        require_phone_validation,
        max_conversation_time,
        notification_email,
        notification_phone,
      };

      // Remover campos undefined
      Object.keys(settingsData).forEach((key) => {
        if (settingsData[key] === undefined) {
          delete settingsData[key];
        }
      });

      if (Object.keys(settingsData).length === 0) {
        return res.status(400).json({
          success: false,
          error: "No hay configuraciones para actualizar",
        });
      }

      // Actualizar configuración
      const updatedSettings = await Restaurant.updateSettings(id, settingsData);

      logger.info("Configuración de restaurante actualizada", {
        restaurantId: id,
        updatedFields: Object.keys(settingsData),
      });

      res.json({
        success: true,
        message: "Configuración actualizada exitosamente",
        data: updatedSettings,
      });
    } catch (error) {
      logger.error("Error actualizando configuración de restaurante:", error);
      res.status(500).json({
        success: false,
        error: "Error actualizando configuración",
      });
    }
  });

  /**
   * Desactiva un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static deactivateRestaurant = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      const success = await Restaurant.deactivate(id);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      }

      logger.info("Restaurante desactivado", { restaurantId: id });

      res.json({
        success: true,
        message: "Restaurante desactivado exitosamente",
      });
    } catch (error) {
      logger.error("Error desactivando restaurante:", error);
      res.status(500).json({
        success: false,
        error: "Error desactivando restaurante",
      });
    }
  });

  /**
   * Activa un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static activateRestaurant = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      const success = await Restaurant.activate(id);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      }

      logger.info("Restaurante activado", { restaurantId: id });

      res.json({
        success: true,
        message: "Restaurante activado exitosamente",
      });
    } catch (error) {
      logger.error("Error activando restaurante:", error);
      res.status(500).json({
        success: false,
        error: "Error activando restaurante",
      });
    }
  });

  /**
   * Obtiene estadísticas de un restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getRestaurantStats = asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!ValidationService.isValidUUID(id)) {
        return res.status(400).json({
          success: false,
          error: "ID de restaurante inválido",
        });
      }

      // Validar parámetros de fecha
      const dateValidation = ValidationService.validateDateRangeParams(
        req.query
      );
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error,
        });
      }

      const { start_date, end_date } = dateValidation.data;

      const dateRange = {};
      if (start_date) dateRange.startDate = start_date;
      if (end_date) dateRange.endDate = end_date;

      // Obtener estadísticas
      const stats = await Restaurant.getStats(id, dateRange);

      logger.info("Estadísticas de restaurante obtenidas", {
        restaurantId: id,
        dateRange: dateRange,
      });

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Error obteniendo estadísticas de restaurante:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo estadísticas",
      });
    }
  });

  /**
   * Verifica disponibilidad de slug
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static checkSlugAvailability = asyncHandler(async (req, res) => {
    try {
      const { slug } = req.params;
      const { exclude_id } = req.query;

      if (!slug || slug.length < 2) {
        return res.status(400).json({
          success: false,
          error: "Slug inválido",
        });
      }

      if (exclude_id && !ValidationService.isValidUUID(exclude_id)) {
        return res.status(400).json({
          success: false,
          error: "ID de exclusión inválido",
        });
      }

      const isAvailable = await Restaurant.isSlugAvailable(slug, exclude_id);

      res.json({
        success: true,
        data: {
          slug,
          available: isAvailable,
        },
      });
    } catch (error) {
      logger.error("Error verificando disponibilidad de slug:", error);
      res.status(500).json({
        success: false,
        error: "Error verificando disponibilidad",
      });
    }
  });

  /**
   * Obtiene el restaurante actual (basado en el middleware de tenant)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getCurrentRestaurant = asyncHandler(async (req, res) => {
    try {
      if (!req.restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no identificado",
        });
      }

      // Obtener datos completos del restaurante
      const restaurant = await Restaurant.findById(req.restaurant.id);

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no encontrado",
        });
      }

      res.json({
        success: true,
        data: restaurant,
      });
    } catch (error) {
      logger.error("Error obteniendo restaurante actual:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo restaurante",
      });
    }
  });

  /**
   * Actualiza el restaurante actual
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateCurrentRestaurant = asyncHandler(async (req, res) => {
    try {
      if (!req.restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no identificado",
        });
      }

      // Reutilizar lógica de actualización
      req.params.id = req.restaurant.id;
      return RestaurantController.updateRestaurant(req, res);
    } catch (error) {
      logger.error("Error actualizando restaurante actual:", error);
      res.status(500).json({
        success: false,
        error: "Error actualizando restaurante",
      });
    }
  });

  /**
   * Obtiene estadísticas del restaurante actual
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getCurrentRestaurantStats = asyncHandler(async (req, res) => {
    try {
      if (!req.restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no identificado",
        });
      }

      // Reutilizar lógica de estadísticas
      req.params.id = req.restaurant.id;
      return RestaurantController.getRestaurantStats(req, res);
    } catch (error) {
      logger.error(
        "Error obteniendo estadísticas del restaurante actual:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Error obteniendo estadísticas",
      });
    }
  });

  /**
   * Obtiene resumen del dashboard del restaurante
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getDashboardSummary = asyncHandler(async (req, res) => {
    try {
      if (!req.restaurant) {
        return res.status(404).json({
          success: false,
          error: "Restaurante no identificado",
        });
      }

      const restaurantId = req.restaurant.id;

      // Obtener estadísticas de diferentes períodos
      const [todayStats, weekStats, monthStats] = await Promise.all([
        Restaurant.getStats(restaurantId, {
          startDate: new Date().toISOString().split("T")[0],
          endDate: new Date().toISOString().split("T")[0],
        }),
        Restaurant.getStats(restaurantId, {
          startDate: new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
          endDate: new Date().toISOString(),
        }),
        Restaurant.getStats(restaurantId, {
          startDate: new Date(
            Date.now() - 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
          endDate: new Date().toISOString(),
        }),
      ]);

      const summary = {
        restaurant: {
          id: req.restaurant.id,
          name: req.restaurant.name,
          slug: req.restaurant.slug,
          is_active: req.restaurant.is_active,
        },
        stats: {
          today: todayStats,
          week: weekStats,
          month: monthStats,
        },
        generated_at: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      logger.error("Error obteniendo resumen del dashboard:", error);
      res.status(500).json({
        success: false,
        error: "Error obteniendo resumen",
      });
    }
  });
}

module.exports = RestaurantController;
