const Order = require("../models/Order");
const Customer = require("../models/Customer");
const Conversation = require("../models/Conversation");
const WhatsAppService = require("./whatsappService");
const ValidationService = require("./validationService");
const logger = require("../utils/logger");
const {
  ORDER_STATUS,
  CONVERSATION_STATUS,
  DEFAULT_MESSAGES,
  BUSINESS_CONFIG,
} = require("../utils/constants");
const {
  ValidationError,
  DatabaseError,
} = require("../middleware/errorHandler");

// ============================================
// SERVICIO DE PEDIDOS
// ============================================

class OrderService {
  /**
   * Crea un pedido desde una conversación
   * @param {Object} conversation - Conversación con el pedido
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<Object>} Pedido creado
   */
  static async createFromConversation(conversation, restaurant) {
    try {
      // Validar conversación
      const validationResult =
        ValidationService.validateOrderFromConversation(conversation);
      if (!validationResult.isValid) {
        throw new ValidationError(validationResult.error);
      }

      // Parsear datos del pedido
      let orderData = {};
      try {
        orderData = JSON.parse(conversation.order_data || "{}");
      } catch (e) {
        throw new ValidationError("Error parseando datos del pedido");
      }

      // Obtener o crear cliente
      const customer = await Customer.findOrCreate(conversation.customer_phone);

      // Calcular tiempo estimado de entrega
      const estimatedTime = await Order.calculateDeliveryTime(
        restaurant.id,
        orderData.delivery_address?.neighborhood
      );

      // Preparar datos del pedido
      const orderPayload = {
        restaurant_id: restaurant.id,
        customer_id: customer.id,
        conversation_id: conversation.id,
        customer_phone: conversation.customer_phone,
        customer_name: customer.name,
        delivery_street: orderData.delivery_address.street,
        delivery_number: orderData.delivery_address.number,
        delivery_neighborhood: orderData.delivery_address.neighborhood,
        delivery_references: orderData.delivery_address.references,
        delivery_postal_code: orderData.delivery_address.postal_code,
        items: orderData.items || [],
        subtotal: orderData.subtotal || 0,
        delivery_fee: this.calculateDeliveryFee(restaurant, orderData),
        total:
          (orderData.subtotal || 0) +
          this.calculateDeliveryFee(restaurant, orderData),
        estimated_delivery_time: estimatedTime,
        special_instructions: orderData.special_instructions,
      };

      // Crear pedido
      const order = await Order.create(orderPayload);

      // Marcar conversación como completada
      await Conversation.complete(conversation.id, order.id);

      // Actualizar estadísticas del cliente
      await Customer.updateOrderStats(customer.id, order.total);

      // Enviar confirmación al cliente
      await this.sendOrderConfirmation(order, restaurant, customer);

      // Notificar al restaurante si está configurado
      await this.notifyRestaurant(order, restaurant);

      logger.info("Pedido creado exitosamente", {
        orderId: order.id,
        restaurantId: restaurant.id,
        customerPhone: customer.phone.substring(0, 8) + "****",
        total: order.total,
        itemsCount: orderPayload.items.length,
      });

      return order;
    } catch (error) {
      logger.error("Error creando pedido desde conversación:", error);
      throw error;
    }
  }

  /**
   * Actualiza el estado de un pedido
   * @param {string} orderId - ID del pedido
   * @param {string} newStatus - Nuevo estado
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Pedido actualizado
   */
  static async updateOrderStatus(orderId, newStatus, options = {}) {
    try {
      const {
        internal_notes = null,
        estimated_delivery_time = null,
        notify_customer = true,
        restaurant = null,
      } = options;

      // Actualizar estado en base de datos
      const updatedOrder = await Order.updateStatus(orderId, newStatus, {
        internal_notes,
        estimated_delivery_time,
      });

      // Obtener datos completos del pedido
      const fullOrder = await Order.findById(orderId);

      // Notificar al cliente si está habilitado
      if (notify_customer && fullOrder) {
        await this.notifyCustomerStatusChange(fullOrder, newStatus);
      }

      // Log del cambio de estado
      logger.info("Estado de pedido actualizado", {
        orderId,
        newStatus,
        previousStatus: updatedOrder.status,
        notifyCustomer: notify_customer,
      });

      return fullOrder;
    } catch (error) {
      logger.error("Error actualizando estado de pedido:", error);
      throw error;
    }
  }

  /**
   * Cancela un pedido
   * @param {string} orderId - ID del pedido
   * @param {string} reason - Razón de cancelación
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Pedido cancelado
   */
  static async cancelOrder(orderId, reason, options = {}) {
    try {
      const { notify_customer = true, cancelled_by = "restaurant" } = options;

      // Cancelar pedido
      const cancelledOrder = await Order.cancel(orderId, reason);

      // Obtener datos completos
      const fullOrder = await Order.findById(orderId);

      // Notificar al cliente
      if (notify_customer && fullOrder) {
        await this.notifyCustomerCancellation(fullOrder, reason, cancelled_by);
      }

      logger.info("Pedido cancelado", {
        orderId,
        reason,
        cancelledBy: cancelled_by,
      });

      return fullOrder;
    } catch (error) {
      logger.error("Error cancelando pedido:", error);
      throw error;
    }
  }

  /**
   * Calcula el costo de envío
   * @param {Object} restaurant - Datos del restaurante
   * @param {Object} orderData - Datos del pedido
   * @returns {number} Costo de envío
   */
  static calculateDeliveryFee(restaurant, orderData) {
    try {
      let deliveryFee = restaurant.delivery_fee || 0;

      // Verificar si hay costo extra por zona
      const neighborhood = orderData.delivery_address?.neighborhood;

      // Aquí se podría consultar la tabla delivery_zones
      // Por ahora usamos el fee base del restaurante

      // Envío gratis si supera el mínimo (si está configurado)
      if (
        restaurant.free_delivery_minimum &&
        orderData.subtotal >= restaurant.free_delivery_minimum
      ) {
        deliveryFee = 0;
      }

      return deliveryFee;
    } catch (error) {
      logger.error("Error calculando costo de envío:", error);
      return restaurant.delivery_fee || 0;
    }
  }

  /**
   * Envía confirmación de pedido al cliente
   * @param {Object} order - Datos del pedido
   * @param {Object} restaurant - Datos del restaurante
   * @param {Object} customer - Datos del cliente
   * @returns {Promise<void>}
   */
  static async sendOrderConfirmation(order, restaurant, customer) {
    try {
      // Preparar datos para el mensaje
      const orderData = {
        items: [],
        subtotal: order.subtotal,
        delivery_fee: order.delivery_fee,
        total: order.total,
        estimated_delivery_time: order.estimated_delivery_time,
        delivery_address: {
          street: order.delivery_street,
          number: order.delivery_number,
          neighborhood: order.delivery_neighborhood,
          references: order.delivery_references,
        },
      };

      // Obtener items del pedido
      const fullOrder = await Order.findById(order.id);
      if (fullOrder && fullOrder.items) {
        orderData.items = fullOrder.items;
      }

      // Generar mensaje de confirmación
      const confirmationMessage = WhatsAppService.generateOrderConfirmation(
        orderData,
        restaurant
      );

      // Enviar mensaje
      await WhatsAppService.sendMessage(
        order.customer_phone,
        confirmationMessage
      );

      logger.info("Confirmación de pedido enviada", {
        orderId: order.id,
        customerPhone: order.customer_phone.substring(0, 8) + "****",
      });
    } catch (error) {
      logger.error("Error enviando confirmación de pedido:", error);
      // No lanzar error para no afectar la creación del pedido
    }
  }

  /**
   * Notifica cambio de estado al cliente
   * @param {Object} order - Datos del pedido
   * @param {string} newStatus - Nuevo estado
   * @returns {Promise<void>}
   */
  static async notifyCustomerStatusChange(order, newStatus) {
    try {
      const statusMessages = {
        [ORDER_STATUS.CONFIRMED]: `✅ Tu pedido ha sido confirmado y está siendo preparado. Tiempo estimado: ${order.estimated_delivery_time || 30} minutos.`,
        [ORDER_STATUS.PREPARING]: `👨‍🍳 Tu pedido está siendo preparado con mucho cariño. ¡Ya casi está listo!`,
        [ORDER_STATUS.READY]: `🛵 ¡Tu pedido está listo! El repartidor saldrá en breve.`,
        [ORDER_STATUS.OUT_FOR_DELIVERY]: `🚗 ¡Tu pedido está en camino! El repartidor llegará pronto.`,
        [ORDER_STATUS.DELIVERED]: `✅ ¡Pedido entregado! Gracias por tu preferencia. ¡Esperamos verte pronto! 🙏`,
      };

      const message = statusMessages[newStatus];

      if (message) {
        await WhatsAppService.sendMessage(order.customer_phone, message);

        logger.info("Notificación de estado enviada", {
          orderId: order.id,
          newStatus,
          customerPhone: order.customer_phone.substring(0, 8) + "****",
        });
      }
    } catch (error) {
      logger.error("Error notificando cambio de estado:", error);
      // No lanzar error para no afectar la actualización
    }
  }

  /**
   * Notifica cancelación al cliente
   * @param {Object} order - Datos del pedido
   * @param {string} reason - Razón de cancelación
   * @param {string} cancelledBy - Quién canceló
   * @returns {Promise<void>}
   */
  static async notifyCustomerCancellation(order, reason, cancelledBy) {
    try {
      let message = `❌ Lamentamos informarte que tu pedido ha sido cancelado.`;

      if (reason) {
        message += `\n\nMotivo: ${reason}`;
      }

      if (cancelledBy === "restaurant") {
        message += `\n\nNos disculpamos por las molestias. Te invitamos a realizar un nuevo pedido cuando gustes. 🙏`;
      }

      message += `\n\n¿Hay algo más en lo que podamos ayudarte?`;

      await WhatsAppService.sendMessage(order.customer_phone, message);

      logger.info("Notificación de cancelación enviada", {
        orderId: order.id,
        reason,
        cancelledBy,
        customerPhone: order.customer_phone.substring(0, 8) + "****",
      });
    } catch (error) {
      logger.error("Error notificando cancelación:", error);
      // No lanzar error para no afectar la cancelación
    }
  }

  /**
   * Notifica al restaurante sobre nuevo pedido
   * @param {Object} order - Datos del pedido
   * @param {Object} restaurant - Datos del restaurante
   * @returns {Promise<void>}
   */
  static async notifyRestaurant(order, restaurant) {
    try {
      // Notificación por WhatsApp si está configurado
      if (restaurant.notification_phone) {
        const message = this.generateRestaurantNotification(order);
        await WhatsAppService.sendMessage(
          restaurant.notification_phone,
          message
        );
      }

      // Notificación por email (se implementaría en el futuro)
      if (restaurant.notification_email) {
        // TODO: Implementar notificación por email
        logger.info(
          "Email notification would be sent to:",
          restaurant.notification_email
        );
      }

      logger.info("Restaurante notificado sobre nuevo pedido", {
        orderId: order.id,
        restaurantId: restaurant.id,
        notificationMethods: {
          whatsapp: !!restaurant.notification_phone,
          email: !!restaurant.notification_email,
        },
      });
    } catch (error) {
      logger.error("Error notificando al restaurante:", error);
      // No lanzar error para no afectar la creación del pedido
    }
  }

  /**
   * Genera mensaje de notificación para el restaurante
   * @param {Object} order - Datos del pedido
   * @returns {string} Mensaje de notificación
   */
  static generateRestaurantNotification(order) {
    try {
      let message = `🔔 *NUEVO PEDIDO*\n\n`;
      message += `*ID:* ${order.id.substring(0, 8)}\n`;
      message += `*Cliente:* ${order.customer_phone}\n`;

      if (order.customer_name) {
        message += `*Nombre:* ${order.customer_name}\n`;
      }

      message += `*Total:* $${order.total}\n`;
      message += `*Dirección:* ${order.delivery_street} ${order.delivery_number}, ${order.delivery_neighborhood}\n`;

      if (order.delivery_references) {
        message += `*Referencias:* ${order.delivery_references}\n`;
      }

      if (order.special_instructions) {
        message += `*Instrucciones:* ${order.special_instructions}\n`;
      }

      message += `\n*Items:*\n`;

      // Si tenemos los items detallados
      if (order.items && order.items.length > 0) {
        order.items.forEach((item, index) => {
          message += `${index + 1}. ${item.item_name} (${item.quantity}x)\n`;

          if (item.customizations && item.customizations.length > 0) {
            const customizations = JSON.parse(item.customizations);
            customizations.forEach((custom) => {
              message += `   • ${custom.name}\n`;
            });
          }
        });
      }

      message += `\n⏰ Tiempo estimado: ${order.estimated_delivery_time || 30} min`;
      message += `\n📅 ${new Date(order.created_at).toLocaleString("es-MX")}`;

      return message;
    } catch (error) {
      logger.error("Error generando notificación para restaurante:", error);
      return `🔔 Nuevo pedido recibido. ID: ${order.id.substring(0, 8)}, Total: $${order.total}`;
    }
  }

  /**
   * Obtiene pedidos activos de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @returns {Promise<Array>} Pedidos activos
   */
  static async getActiveOrders(restaurantId) {
    try {
      const activeOrders = await Order.getActiveOrders(restaurantId);

      // Agregar tiempo transcurrido y alertas
      const ordersWithAlerts = activeOrders.map((order) => {
        const minutesSinceOrder = parseFloat(order.minutes_since_order || 0);
        const estimatedTime = order.estimated_delivery_time || 30;

        return {
          ...order,
          is_delayed: minutesSinceOrder > estimatedTime + 10, // 10 minutos de gracia
          is_urgent: minutesSinceOrder > estimatedTime - 5, // Falta poco para el tiempo estimado
          minutes_since_order: Math.round(minutesSinceOrder),
        };
      });

      return ordersWithAlerts;
    } catch (error) {
      logger.error("Error obteniendo pedidos activos:", error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de pedidos
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} dateRange - Rango de fechas
   * @returns {Promise<Object>} Estadísticas detalladas
   */
  static async getOrderStatistics(restaurantId, dateRange = {}) {
    try {
      // Estadísticas básicas
      const basicStats = await Order.getStats(restaurantId, dateRange);

      // Items más vendidos
      const topItems = await Order.getTopItems(restaurantId, dateRange, 10);

      // Resumen por períodos
      const dailySummary = await Order.getSalesSummary(restaurantId, "today");
      const weeklySummary = await Order.getSalesSummary(restaurantId, "week");
      const monthlySummary = await Order.getSalesSummary(restaurantId, "month");

      return {
        basic: basicStats,
        top_items: topItems,
        summaries: {
          today: dailySummary,
          week: weeklySummary,
          month: monthlySummary,
        },
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error obteniendo estadísticas de pedidos:", error);
      throw error;
    }
  }

  /**
   * Busca pedidos con filtros avanzados
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} filters - Filtros de búsqueda
   * @returns {Promise<Object>} Resultados de búsqueda
   */
  static async searchOrders(restaurantId, filters = {}) {
    try {
      const {
        customer_phone = null,
        status = null,
        start_date = null,
        end_date = null,
        min_total = null,
        max_total = null,
        neighborhood = null,
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "DESC",
      } = filters;

      // Preparar opciones para el modelo
      const searchOptions = {
        page: parseInt(page),
        limit: parseInt(limit),
        sortBy: sort_by,
        sortOrder: sort_order.toUpperCase(),
      };

      // Agregar filtros
      if (status) searchOptions.status = status;
      if (customer_phone) searchOptions.customerPhone = customer_phone;
      if (start_date) searchOptions.startDate = start_date;
      if (end_date) searchOptions.endDate = end_date;

      const results = await Order.findByRestaurant(restaurantId, searchOptions);

      // Filtros adicionales que no están en el modelo base
      if (min_total || max_total || neighborhood) {
        results.orders = results.orders.filter((order) => {
          if (min_total && order.total < min_total) return false;
          if (max_total && order.total > max_total) return false;
          if (
            neighborhood &&
            !order.delivery_neighborhood
              ?.toLowerCase()
              .includes(neighborhood.toLowerCase())
          )
            return false;
          return true;
        });

        // Recalcular paginación después del filtro
        results.pagination.total_items = results.orders.length;
        results.pagination.total_pages = Math.ceil(
          results.orders.length / limit
        );
      }

      return results;
    } catch (error) {
      logger.error("Error buscando pedidos:", error);
      throw error;
    }
  }

  /**
   * Valida si un pedido puede ser modificado
   * @param {string} orderId - ID del pedido
   * @returns {Promise<Object>} Resultado de validación
   */
  static async validateOrderModification(orderId) {
    try {
      const order = await Order.findById(orderId);

      if (!order) {
        return {
          canModify: false,
          reason: "Pedido no encontrado",
        };
      }

      // No se puede modificar si ya está entregado o cancelado
      if (
        [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status)
      ) {
        return {
          canModify: false,
          reason: `No se puede modificar un pedido ${order.status}`,
        };
      }

      // No se puede modificar si ya está en camino
      if (order.status === ORDER_STATUS.OUT_FOR_DELIVERY) {
        return {
          canModify: false,
          reason: "El pedido ya está en camino",
        };
      }

      // Verificar tiempo transcurrido
      const minutesSinceOrder =
        (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60);

      if (minutesSinceOrder > 10) {
        // 10 minutos límite para modificaciones
        return {
          canModify: false,
          reason: "Tiempo límite para modificaciones excedido",
        };
      }

      return {
        canModify: true,
        order,
      };
    } catch (error) {
      logger.error("Error validando modificación de pedido:", error);
      return {
        canModify: false,
        reason: "Error interno",
      };
    }
  }
  /**
   * Genera reporte de ventas
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} options - Opciones del reporte
   * @returns {Promise<Object>} Reporte generado
   */
  static async generateSalesReport(restaurantId, options = {}) {
    try {
      const {
        start_date = null,
        end_date = null,
        group_by = "day",
        include_items = false,
      } = options;

      const dateRange = {};
      if (start_date) {
        // Usar solo la fecha sin hora para evitar problemas de zona horaria
        dateRange.startDate = start_date;
      }
      if (end_date) {
        // Usar solo la fecha sin hora
        dateRange.endDate = end_date;
      }

      const report = {
        restaurant_id: restaurantId,
        period: { start_date, end_date },
        generated_at: new Date().toISOString(),
        summary: await Order.getStats(restaurantId, dateRange),
      };

      if (include_items) {
        report.top_items = await Order.getTopItems(restaurantId, dateRange, 20);
      }

      // Agregar agrupación por período (esto requeriría consultas adicionales)
      report.group_by = group_by;
      report.grouped_data = []; // Placeholder para datos agrupados

      return report;
    } catch (error) {
      logger.error("Error generando reporte de ventas:", error);
      throw error;
    }
  }

  /**
   * Obtiene resumen rápido de pedidos para el día actual
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Resumen de pedidos
   */
  static async getOrdersSummary(restaurantId, options = {}) {
    try {
      // Obtener resumen del día actual
      const todaySummary = await Order.getSalesSummary(restaurantId, "today");

      // Obtener estadísticas básicas del día
      const today = new Date();
      const startOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
      const endOfDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        23,
        59,
        59
      );

      const dateRange = {
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      };

      const basicStats = await Order.getStats(restaurantId, dateRange);

      return {
        total_orders: basicStats.total_orders || 0,
        orders_today: todaySummary.total_orders || 0,
        revenue_today: todaySummary.total_revenue || 0,
        active_orders: basicStats.active_orders || 0,
        pending_orders: basicStats.pending_orders || 0,
        completed_orders: basicStats.completed_orders || 0,
        cancelled_orders: basicStats.cancelled_orders || 0,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error obteniendo resumen de pedidos:", error);
      throw error;
    }
  }
}

module.exports = OrderService;
