const Order = require('../models/Order');
const OrderService = require('../services/orderService');
const ValidationService = require('../services/validationService');
const logger = require('../utils/logger');
const { ORDER_STATUS } = require('../utils/constants');
const { asyncHandler } = require('../middleware/errorHandler');

// ============================================
// CONTROLADOR DE PEDIDOS
// ============================================

class OrderController {

  /**
   * Obtiene pedidos de un restaurante con filtros
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getOrders = asyncHandler(async (req, res) => {
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

      // Validar parámetros de paginación
      const paginationValidation = ValidationService.validatePaginationParams(req.query);
      if (!paginationValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: paginationValidation.error
        });
      }

      const { page, limit, sort_by, sort_order } = paginationValidation.data;

      // Preparar filtros
      const filters = {
        page,
        limit,
        sort_by,
        sort_order,
        status: req.query.status,
        customer_phone: req.query.customer_phone,
        start_date: req.query.start_date,
        end_date: req.query.end_date
      };

      // Validar fechas si están presentes
      if (filters.start_date || filters.end_date) {
        const dateValidation = ValidationService.validateDateRangeParams({
          start_date: filters.start_date,
          end_date: filters.end_date
        });
        
        if (!dateValidation.isValid) {
          return res.status(400).json({
            success: false,
            error: dateValidation.error
          });
        }
      }

      // Obtener pedidos
      const result = await Order.findByRestaurant(restaurantId, filters);

      logger.info('Pedidos obtenidos', {
        restaurantId,
        page,
        limit,
        totalItems: result.pagination.total_items,
        filtersApplied: Object.keys(filters).filter(key => filters[key]).length
      });

      res.json({
        success: true,
        data: result.orders,
        pagination: result.pagination,
        filters_applied: filters
      });

    } catch (error) {
      logger.error('Error obteniendo pedidos:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo pedidos'
      });
    }
  });

  /**
   * Obtiene un pedido específico por ID
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getOrderById = asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;
      const restaurantId = req.restaurant?.id;

      if (!ValidationService.isValidUUID(orderId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de pedido inválido'
        });
      }

      const order = await Order.findById(orderId, restaurantId);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Pedido no encontrado'
        });
      }

      logger.info('Pedido obtenido por ID', {
        orderId,
        restaurantId: order.restaurant_id,
        status: order.status
      });

      res.json({
        success: true,
        data: order
      });

    } catch (error) {
      logger.error('Error obteniendo pedido por ID:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo pedido'
      });
    }
  });

  /**
   * Crea un nuevo pedido manualmente
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static createOrder = asyncHandler(async (req, res) => {
    try {
      // Validar datos del pedido
      const validation = ValidationService.validateOrderCreation(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      const orderData = validation.data;

      // Validar dirección de entrega
      const addressValidation = ValidationService.validateDeliveryAddress(orderData.delivery_address);
      if (!addressValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: `Dirección inválida: ${addressValidation.error}`
        });
      }

      // Expandir datos de dirección
      const expandedOrderData = {
        ...orderData,
        delivery_street: orderData.delivery_address.street,
        delivery_number: orderData.delivery_address.number,
        delivery_neighborhood: orderData.delivery_address.neighborhood,
        delivery_references: orderData.delivery_address.references,
        delivery_postal_code: orderData.delivery_address.postal_code
      };

      // Calcular tiempo estimado de entrega
      const estimatedTime = await Order.calculateDeliveryTime(
        orderData.restaurant_id,
        orderData.delivery_address.neighborhood
      );
      expandedOrderData.estimated_delivery_time = estimatedTime;

      // Crear pedido
      const order = await Order.create(expandedOrderData);

      logger.info('Pedido creado manualmente', {
        orderId: order.id,
        restaurantId: order.restaurant_id,
        customerPhone: order.customer_phone?.substring(0, 8) + '****',
        total: order.total
      });

      res.status(201).json({
        success: true,
        message: 'Pedido creado exitosamente',
        data: order
      });

    } catch (error) {
      logger.error('Error creando pedido:', error);
      res.status(500).json({
        success: false,
        error: 'Error creando pedido'
      });
    }
  });

  /**
   * Actualiza el estado de un pedido
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static updateOrderStatus = asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;

      if (!ValidationService.isValidUUID(orderId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de pedido inválido'
        });
      }

      // Validar datos de actualización
      const validation = ValidationService.validateOrderStatusUpdate(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }

      const { status, internal_notes, estimated_delivery_time } = validation.data;

      // Actualizar estado usando el servicio
      const updatedOrder = await OrderService.updateOrderStatus(orderId, status, {
        internal_notes,
        estimated_delivery_time,
        notify_customer: req.body.notify_customer !== false, // Default true
        restaurant: req.restaurant
      });

      logger.info('Estado de pedido actualizado', {
        orderId,
        newStatus: status,
        notifyCustomer: req.body.notify_customer !== false
      });

      res.json({
        success: true,
        message: 'Estado actualizado exitosamente',
        data: updatedOrder
      });

    } catch (error) {
      logger.error('Error actualizando estado de pedido:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Pedido no encontrado'
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error actualizando pedido'
        });
      }
    }
  });

  /**
   * Cancela un pedido
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static cancelOrder = asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;
      const { reason, notify_customer = true } = req.body;

      if (!ValidationService.isValidUUID(orderId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de pedido inválido'
        });
      }

      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Razón de cancelación es requerida'
        });
      }

      // Cancelar pedido usando el servicio
      const cancelledOrder = await OrderService.cancelOrder(orderId, reason, {
        notify_customer,
        cancelled_by: 'restaurant'
      });

      logger.info('Pedido cancelado', {
        orderId,
        reason,
        notifyCustomer: notify_customer
      });

      res.json({
        success: true,
        message: 'Pedido cancelado exitosamente',
        data: cancelledOrder
      });

    } catch (error) {
      logger.error('Error cancelando pedido:', error);
      
      if (error.message.includes('no encontrado')) {
        res.status(404).json({
          success: false,
          error: 'Pedido no encontrado'
        });
      } else if (error.message.includes('no se puede cancelar')) {
        res.status(400).json({
          success: false,
          error: error.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Error cancelando pedido'
        });
      }
    }
  });

  /**
   * Obtiene pedidos activos (en preparación/camino)
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getActiveOrders = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      const activeOrders = await OrderService.getActiveOrders(restaurantId);

      logger.info('Pedidos activos obtenidos', {
        restaurantId,
        count: activeOrders.length,
        delayedCount: activeOrders.filter(o => o.is_delayed).length,
        urgentCount: activeOrders.filter(o => o.is_urgent).length
      });

      res.json({
        success: true,
        data: {
          orders: activeOrders,
          summary: {
            total: activeOrders.length,
            delayed: activeOrders.filter(o => o.is_delayed).length,
            urgent: activeOrders.filter(o => o.is_urgent).length,
            on_time: activeOrders.filter(o => !o.is_delayed && !o.is_urgent).length
          }
        }
      });

    } catch (error) {
      logger.error('Error obteniendo pedidos activos:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo pedidos activos'
      });
    }
  });

  /**
   * Obtiene estadísticas de pedidos
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getOrderStatistics = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar parámetros de fecha
      const dateValidation = ValidationService.validateDateRangeParams(req.query);
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }

      const { start_date, end_date } = dateValidation.data;

      const dateRange = {};
      if (start_date) dateRange.startDate = start_date;
      if (end_date) dateRange.endDate = end_date;

      // Obtener estadísticas usando el servicio
      const statistics = await OrderService.getOrderStatistics(restaurantId, dateRange);

      logger.info('Estadísticas de pedidos obtenidas', {
        restaurantId,
        dateRange,
        totalOrders: statistics.basic.total_orders
      });

      res.json({
        success: true,
        data: statistics
      });

    } catch (error) {
      logger.error('Error obteniendo estadísticas de pedidos:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo estadísticas'
      });
    }
  });

  /**
   * Busca pedidos con filtros avanzados
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static searchOrders = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar parámetros de paginación
      const paginationValidation = ValidationService.validatePaginationParams(req.query);
      if (!paginationValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: paginationValidation.error
        });
      }

      const filters = {
        ...paginationValidation.data,
        customer_phone: req.query.customer_phone,
        status: req.query.status,
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        min_total: req.query.min_total ? parseFloat(req.query.min_total) : null,
        max_total: req.query.max_total ? parseFloat(req.query.max_total) : null,
        neighborhood: req.query.neighborhood
      };

      // Realizar búsqueda
      const results = await OrderService.searchOrders(restaurantId, filters);

      logger.info('Búsqueda de pedidos realizada', {
        restaurantId,
        filtersCount: Object.keys(filters).filter(key => filters[key]).length,
        resultsCount: results.pagination.total_items
      });

      res.json({
        success: true,
        data: results.orders,
        pagination: results.pagination,
        filters_applied: filters
      });

    } catch (error) {
      logger.error('Error buscando pedidos:', error);
      res.status(500).json({
        success: false,
        error: 'Error realizando búsqueda'
      });
    }
  });

  /**
   * Obtiene pedidos de un cliente específico
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getCustomerOrders = asyncHandler(async (req, res) => {
    try {
      const { customerPhone } = req.params;
      const restaurantId = req.restaurant?.id;
      const { limit = 10 } = req.query;

      if (!customerPhone) {
        return res.status(400).json({
          success: false,
          error: 'Teléfono del cliente requerido'
        });
      }

      if (!ValidationService.isValidMexicanPhone(customerPhone)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de teléfono inválido'
        });
      }

      const limitNumber = parseInt(limit);
      if (limitNumber < 1 || limitNumber > 50) {
        return res.status(400).json({
          success: false,
          error: 'Límite debe estar entre 1 y 50'
        });
      }

      // Obtener pedidos del cliente
      const orders = await Order.findByCustomer(customerPhone, restaurantId, limitNumber);

      logger.info('Pedidos de cliente obtenidos', {
        customerPhone: customerPhone.substring(0, 8) + '****',
        restaurantId: restaurantId || 'all',
        ordersFound: orders.length
      });

      res.json({
        success: true,
        data: {
          customer_phone: customerPhone,
          orders,
          total_found: orders.length
        }
      });

    } catch (error) {
      logger.error('Error obteniendo pedidos de cliente:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo pedidos del cliente'
      });
    }
  });

  /**
   * Genera reporte de ventas
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static generateSalesReport = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Validar parámetros de fecha
      const dateValidation = ValidationService.validateDateRangeParams(req.query);
      if (!dateValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: dateValidation.error
        });
      }

      const {
        start_date,
        end_date,
        group_by = 'day',
        include_items = 'false'
      } = req.query;

      const options = {
        start_date,
        end_date,
        group_by,
        include_items: include_items === 'true'
      };

      // Generar reporte
      const report = await OrderService.generateSalesReport(restaurantId, options);

      logger.info('Reporte de ventas generado', {
        restaurantId,
        dateRange: { start_date, end_date },
        groupBy: group_by,
        includeItems: options.include_items
      });

      res.json({
        success: true,
        data: report
      });

    } catch (error) {
      logger.error('Error generando reporte de ventas:', error);
      res.status(500).json({
        success: false,
        error: 'Error generando reporte'
      });
    }
  });

  /**
   * Valida si un pedido puede ser modificado
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static validateOrderModification = asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;

      if (!ValidationService.isValidUUID(orderId)) {
        return res.status(400).json({
          success: false,
          error: 'ID de pedido inválido'
        });
      }

      // Validar modificación usando el servicio
      const validation = await OrderService.validateOrderModification(orderId);

      res.json({
        success: true,
        data: {
          can_modify: validation.canModify,
          reason: validation.reason,
          order: validation.order || null
        }
      });

    } catch (error) {
      logger.error('Error validando modificación de pedido:', error);
      res.status(500).json({
        success: false,
        error: 'Error validando modificación'
      });
    }
  });

  /**
   * Obtiene resumen rápido de pedidos
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static getOrdersSummary = asyncHandler(async (req, res) => {
    try {
      const restaurantId = req.restaurant?.id || req.params.restaurantId;
      
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          error: 'ID de restaurante requerido'
        });
      }

      // Obtener resúmenes de diferentes períodos
      const [todaySummary, weekSummary, monthSummary] = await Promise.all([
        Order.getSalesSummary(restaurantId, 'today'),
        Order.getSalesSummary(restaurantId, 'week'),
        Order.getSalesSummary(restaurantId, 'month')
      ]);

      // Obtener pedidos activos
      const activeOrders = await OrderService.getActiveOrders(restaurantId);

      const summary = {
        restaurant_id: restaurantId,
        active_orders: {
          total: activeOrders.length,
          delayed: activeOrders.filter(o => o.is_delayed).length,
          urgent: activeOrders.filter(o => o.is_urgent).length
        },
        sales_summary: {
          today: todaySummary,
          week: weekSummary,
          month: monthSummary
        },
        generated_at: new Date().toISOString()
      };

      res.json({
        success: true,
        data: summary
      });

    } catch (error) {
      logger.error('Error obteniendo resumen de pedidos:', error);
      res.status(500).json({
        success: false,
        error: 'Error obteniendo resumen'
      });
    }
  });

  /**
   * Actualiza múltiples pedidos en lote
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   */
  static batchUpdateOrders = asyncHandler(async (req, res) => {
    try {
      const { updates } = req.body;

      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Se requiere un array de actualizaciones'
        });
      }

      if (updates.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Máximo 50 actualizaciones por lote'
        });
      }

      // Validar estructura de actualizaciones  
      for (const update of updates) {
        if (!update.order_id || !ValidationService.isValidUUID(update.order_id)) {
          return res.status(400).json({
            success: false,
            error: 'ID de pedido inválido en actualizaciones'
          });
        }

        if (!update.status || !Object.values(ORDER_STATUS).includes(update.status)) {
          return res.status(400).json({
            success: false,
            error: 'Estado inválido en actualizaciones'
          });
        }
      }

      // Procesar actualizaciones
      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const update of updates) {
        try {
          const updatedOrder = await OrderService.updateOrderStatus(
            update.order_id,
            update.status,
            {
              internal_notes: update.internal_notes,
              notify_customer: update.notify_customer !== false
            }
          );

          results.push({
            order_id: update.order_id,
            success: true,
            new_status: update.status
          });
          successCount++;

        } catch (error) {
          results.push({
            order_id: update.order_id,
            success: false,
            error: error.message
          });
          errorCount++;
        }
      }

      logger.info('Actualización en lote de pedidos completada', {
        totalUpdates: updates.length,
        successCount,
        errorCount
      });

      res.json({
        success: true,
        message: `Actualizaciones completadas: ${successCount} exitosas, ${errorCount} errores`,
        data: {
          results,
          summary: {
            total: updates.length,
            successful: successCount,
            failed: errorCount
          }
        }
      });

    } catch (error) {
      logger.error('Error en actualización en lote de pedidos:', error);
      res.status(500).json({
        success: false,
        error: 'Error en actualización en lote'
      });
    }
  });
}

module.exports = OrderController;