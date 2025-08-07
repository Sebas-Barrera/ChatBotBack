const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { ValidationError, DatabaseError, NotFoundError } = require('../middleware/errorHandler');
const { getFoodEmoji } = require('../utils/constants');

// ============================================
// MODELO MENU
// ============================================

class Menu {

  // ============================================
  // CATEGORÍAS
  // ============================================

  /**
   * Crea una nueva categoría de menú
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} categoryData - Datos de la categoría
   * @returns {Promise<Object>} Categoría creada
   */
  static async createCategory(restaurantId, categoryData) {
    const {
      name,
      description = '',
      display_order = 0,
      emoji = null
    } = categoryData;

    if (!name) {
      throw new ValidationError('El nombre de la categoría es requerido');
    }

    try {
      // Auto-asignar emoji si no se proporciona
      const finalEmoji = emoji || getFoodEmoji(name);

      const result = await query(
        `INSERT INTO menu_categories (
          id, restaurant_id, name, description, display_order, emoji
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [uuidv4(), restaurantId, name, description, display_order, finalEmoji],
        'create_menu_category'
      );

      logger.info('Categoría de menú creada', {
        restaurantId,
        categoryId: result.rows[0].id,
        name
      });

      return result.rows[0];

    } catch (error) {
      if (error.code === '23505') { // unique violation
        throw new ValidationError('Ya existe una categoría con ese nombre en este restaurante');
      }

      logger.error('Error creando categoría de menú:', error);
      throw new DatabaseError('Error al crear categoría', error);
    }
  }

  /**
   * Obtiene todas las categorías de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {boolean} activeOnly - Solo categorías activas
   * @returns {Promise<Array>} Lista de categorías
   */
  static async getCategories(restaurantId, activeOnly = true) {
    try {
      let whereClause = 'WHERE restaurant_id = $1';
      if (activeOnly) {
        whereClause += ' AND is_active = true';
      }

      const result = await query(
        `SELECT 
          id, name, description, display_order, emoji, is_active,
          created_at,
          (SELECT COUNT(*) FROM menu_items WHERE category_id = mc.id AND is_available = true) as items_count
        FROM menu_categories mc
        ${whereClause}
        ORDER BY display_order, name`,
        [restaurantId],
        'get_menu_categories'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo categorías de menú:', error);
      throw new DatabaseError('Error al obtener categorías', error);
    }
  }

  /**
   * Actualiza una categoría
   * @param {string} categoryId - ID de la categoría
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} Categoría actualizada
   */
  static async updateCategory(categoryId, updateData) {
    const allowedFields = ['name', 'description', 'display_order', 'emoji', 'is_active'];
    
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError('No hay campos válidos para actualizar');
    }

    values.push(categoryId);

    try {
      const result = await query(
        `UPDATE menu_categories 
         SET ${fields.join(', ')}
         WHERE id = $${paramCount}
         RETURNING *`,
        values,
        'update_menu_category'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Categoría');
      }

      logger.info('Categoría actualizada', {
        categoryId,
        updatedFields: Object.keys(updateData)
      });

      return result.rows[0];

    } catch (error) {
      if (error.code === '23505') {
        throw new ValidationError('Ya existe una categoría con ese nombre');
      }

      logger.error('Error actualizando categoría:', error);
      throw new DatabaseError('Error al actualizar categoría', error);
    }
  }

  // ============================================
  // ITEMS DEL MENÚ
  // ============================================

  /**
   * Crea un nuevo item del menú
   * @param {string} restaurantId - ID del restaurante
   * @param {Object} itemData - Datos del item
   * @returns {Promise<Object>} Item creado
   */
  static async createItem(restaurantId, itemData) {
    const {
      category_id,
      name,
      description = '',
      price,
      preparation_time = 15,
      display_order = 0,
      ingredients = [],
      allergens = [],
      calories = null,
      image_url = null
    } = itemData;

    if (!category_id || !name || !price) {
      throw new ValidationError('Categoría, nombre y precio son requeridos');
    }

    if (price <= 0) {
      throw new ValidationError('El precio debe ser mayor a 0');
    }

    try {
      // Verificar que la categoría pertenece al restaurante
      const categoryCheck = await query(
        'SELECT id FROM menu_categories WHERE id = $1 AND restaurant_id = $2',
        [category_id, restaurantId],
        'check_category_ownership'
      );

      if (categoryCheck.rows.length === 0) {
        throw new ValidationError('La categoría no pertenece a este restaurante');
      }

      const result = await query(
        `INSERT INTO menu_items (
          id, restaurant_id, category_id, name, description, price,
          preparation_time, display_order, ingredients, allergens, calories, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          uuidv4(), restaurantId, category_id, name, description, price,
          preparation_time, display_order, ingredients, allergens, calories, image_url
        ],
        'create_menu_item'
      );

      logger.info('Item de menú creado', {
        restaurantId,
        itemId: result.rows[0].id,
        name,
        price
      });

      return result.rows[0];

    } catch (error) {
      logger.error('Error creando item de menú:', error);
      throw new DatabaseError('Error al crear item de menú', error);
    }
  }

  /**
   * Obtiene el menú completo de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {boolean} availableOnly - Solo items disponibles
   * @returns {Promise<Object>} Menú organizado por categorías
   */
  static async getFullMenu(restaurantId, availableOnly = true) {
    try {
      let itemCondition = 'mi.restaurant_id = $1';
      if (availableOnly) {
        itemCondition += ' AND mi.is_available = true AND mc.is_active = true';
      }

      const result = await query(
        `SELECT 
          mc.id as category_id,
          mc.name as category_name,
          mc.description as category_description,
          mc.emoji as category_emoji,
          mc.display_order as category_order,
          mi.id as item_id,
          mi.name as item_name,
          mi.description as item_description,
          mi.price,
          mi.preparation_time,
          mi.display_order as item_order,
          mi.ingredients,
          mi.allergens,
          mi.calories,
          mi.image_url,
          mi.is_available
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mc.id = mi.category_id AND ${itemCondition}
        WHERE mc.restaurant_id = $1
        ORDER BY mc.display_order, mc.name, mi.display_order, mi.name`,
        [restaurantId],
        'get_full_menu'
      );

      // Organizar por categorías
      const menu = {};
      
      result.rows.forEach(row => {
        const categoryKey = row.category_id;
        
        if (!menu[categoryKey]) {
          menu[categoryKey] = {
            id: row.category_id,
            name: row.category_name,
            description: row.category_description,
            emoji: row.category_emoji,
            display_order: row.category_order,
            items: []
          };
        }

        if (row.item_id) {
          menu[categoryKey].items.push({
            id: row.item_id,
            name: row.item_name,
            description: row.item_description,
            price: parseFloat(row.price),
            preparation_time: row.preparation_time,
            display_order: row.item_order,
            ingredients: row.ingredients || [],
            allergens: row.allergens || [],
            calories: row.calories,
            image_url: row.image_url,
            is_available: row.is_available
          });
        }
      });

      // Convertir a array ordenado
      const menuArray = Object.values(menu).sort((a, b) => a.display_order - b.display_order);

      return {
        restaurant_id: restaurantId,
        categories: menuArray,
        total_categories: menuArray.length,
        total_items: menuArray.reduce((sum, cat) => sum + cat.items.length, 0)
      };

    } catch (error) {
      logger.error('Error obteniendo menú completo:', error);
      throw new DatabaseError('Error al obtener menú', error);
    }
  }

  /**
   * Obtiene un item específico del menú
   * @param {string} itemId - ID del item
   * @param {string} restaurantId - ID del restaurante (para verificación)
   * @returns {Promise<Object|null>} Item del menú
   */
  static async getItem(itemId, restaurantId = null) {
    try {
      let whereClause = 'WHERE mi.id = $1';
      const values = [itemId];

      if (restaurantId) {
        whereClause += ' AND mi.restaurant_id = $2';
        values.push(restaurantId);
      }

      const result = await query(
        `SELECT 
          mi.*,
          mc.name as category_name,
          mc.emoji as category_emoji
        FROM menu_items mi
        JOIN menu_categories mc ON mi.category_id = mc.id
        ${whereClause}`,
        values,
        'get_menu_item'
      );

      return result.rows[0] || null;

    } catch (error) {
      logger.error('Error obteniendo item de menú:', error);
      throw new DatabaseError('Error al obtener item', error);
    }
  }

  /**
   * Actualiza un item del menú
   * @param {string} itemId - ID del item
   * @param {Object} updateData - Datos a actualizar
   * @returns {Promise<Object>} Item actualizado
   */
  static async updateItem(itemId, updateData) {
    const allowedFields = [
      'category_id', 'name', 'description', 'price', 'is_available',
      'preparation_time', 'display_order', 'ingredients', 'allergens',
      'calories', 'image_url'
    ];

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updateData[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new ValidationError('No hay campos válidos para actualizar');
    }

    // Validar precio si se está actualizando
    if (updateData.price !== undefined && updateData.price <= 0) {
      throw new ValidationError('El precio debe ser mayor a 0');
    }

    values.push(itemId);

    try {
      const result = await query(
        `UPDATE menu_items 
         SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $${paramCount}
         RETURNING *`,
        values,
        'update_menu_item'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Item de menú');
      }

      logger.info('Item de menú actualizado', {
        itemId,
        updatedFields: Object.keys(updateData)
      });

      return result.rows[0];

    } catch (error) {
      logger.error('Error actualizando item de menú:', error);
      throw new DatabaseError('Error al actualizar item', error);
    }
  }

  /**
   * Cambia disponibilidad de un item
   * @param {string} itemId - ID del item
   * @param {boolean} isAvailable - Nueva disponibilidad
   * @returns {Promise<boolean>} True si se actualizó correctamente
   */
  static async setItemAvailability(itemId, isAvailable) {
    try {
      const result = await query(
        'UPDATE menu_items SET is_available = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
        [isAvailable, itemId],
        'set_item_availability'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Item de menú');
      }

      logger.info('Disponibilidad de item actualizada', {
        itemId,
        isAvailable
      });

      return true;

    } catch (error) {
      logger.error('Error actualizando disponibilidad de item:', error);
      throw new DatabaseError('Error al actualizar disponibilidad', error);
    }
  }

  /**
   * Elimina un item del menú (soft delete)
   * @param {string} itemId - ID del item
   * @returns {Promise<boolean>} True si se eliminó correctamente
   */
  static async deleteItem(itemId) {
    try {
      // Verificar si el item tiene pedidos asociados
      const ordersCheck = await query(
        'SELECT COUNT(*) as count FROM order_items WHERE menu_item_id = $1',
        [itemId],
        'check_item_orders'
      );

      if (parseInt(ordersCheck.rows[0].count) > 0) {
        // Si hay pedidos, solo desactivar
        return await this.setItemAvailability(itemId, false);
      }

      // Si no hay pedidos, eliminar físicamente
      const result = await query(
        'DELETE FROM menu_items WHERE id = $1 RETURNING id',
        [itemId],
        'delete_menu_item'
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Item de menú');
      }

      logger.info('Item de menú eliminado', { itemId });
      return true;

    } catch (error) {
      logger.error('Error eliminando item de menú:', error);
      throw new DatabaseError('Error al eliminar item', error);
    }
  }

  /**
   * Busca items en el menú
   * @param {string} restaurantId - ID del restaurante
   * @param {string} searchTerm - Término de búsqueda
   * @param {Object} filters - Filtros adicionales
   * @returns {Promise<Array>} Items encontrados
   */
  static async searchItems(restaurantId, searchTerm, filters = {}) {
    const {
      categoryId = null,
      minPrice = null,
      maxPrice = null,
      availableOnly = true
    } = filters;

    try {
      const conditions = ['mi.restaurant_id = $1'];
      const values = [restaurantId];
      let paramCount = 2;

      if (searchTerm) {
        conditions.push(`(mi.name ILIKE $${paramCount} OR mi.description ILIKE $${paramCount})`);
        values.push(`%${searchTerm}%`);
        paramCount++;
      }

      if (categoryId) {
        conditions.push(`mi.category_id = $${paramCount}`);
        values.push(categoryId);
        paramCount++;
      }

      if (minPrice !== null) {
        conditions.push(`mi.price >= $${paramCount}`);
        values.push(minPrice);
        paramCount++;
      }

      if (maxPrice !== null) {
        conditions.push(`mi.price <= $${paramCount}`);
        values.push(maxPrice);
        paramCount++;
      }

      if (availableOnly) {
        conditions.push('mi.is_available = true');
        conditions.push('mc.is_active = true');
      }

      const result = await query(
        `SELECT 
          mi.*,
          mc.name as category_name,
          mc.emoji as category_emoji
        FROM menu_items mi
        JOIN menu_categories mc ON mi.category_id = mc.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY mi.name`,
        values,
        'search_menu_items'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error buscando items de menú:', error);
      throw new DatabaseError('Error al buscar items', error);
    }
  }

  /**
   * Obtiene items más populares de un restaurante
   * @param {string} restaurantId - ID del restaurante
   * @param {number} limit - Número de items a retornar
   * @returns {Promise<Array>} Items más populares
   */
  static async getPopularItems(restaurantId, limit = 10) {
    try {
      const result = await query(
        `SELECT 
          mi.*,
          mc.name as category_name,
          COUNT(oi.id) as order_count,
          SUM(oi.quantity) as total_quantity,
          COALESCE(SUM(oi.item_total), 0) as total_revenue
        FROM menu_items mi
        JOIN menu_categories mc ON mi.category_id = mc.id
        LEFT JOIN order_items oi ON mi.id = oi.menu_item_id
        WHERE mi.restaurant_id = $1 AND mi.is_available = true
        GROUP BY mi.id, mc.name
        ORDER BY order_count DESC, total_quantity DESC
        LIMIT $2`,
        [restaurantId, limit],
        'get_popular_items'
      );

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo items populares:', error);
      throw new DatabaseError('Error al obtener items populares', error);
    }
  }

  /**
   * Actualiza orden de display en lote
   * @param {Array} updates - Array de {id, display_order}
   * @returns {Promise<boolean>} True si se actualizó correctamente
   */
  static async updateDisplayOrder(updates) {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new ValidationError('Se requiere un array de actualizaciones');
    }

    try {
      return await transaction(async (client) => {
        for (const update of updates) {
          await client.query(
            'UPDATE menu_items SET display_order = $1 WHERE id = $2',
            [update.display_order, update.id]
          );
        }

        logger.info('Orden de display actualizado', {
          updatedCount: updates.length
        });

        return true;
      });

    } catch (error) {
      logger.error('Error actualizando orden de display:', error);
      throw new DatabaseError('Error al actualizar orden', error);
    }
  }
}

module.exports = Menu;