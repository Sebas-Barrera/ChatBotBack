const { query, transaction } = require('../../database/connection');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { DatabaseError, NotFoundError, AuthenticationError } = require('../middleware/errorHandler');

// ============================================
// MODELO DE USUARIO
// ============================================

class User {
  /**
   * Busca usuario por email con perfil y rol
   * @param {string} email - Email del usuario
   * @returns {Promise<Object|null>} Usuario con perfil y rol
   */
  static async findByEmailWithProfile(email) {
    try {
      const result = await query(
        `SELECT 
          u.id as user_id,
          u.email,
          u.password_hash,
          u.first_name,
          u.last_name,
          u.is_active,
          u.email_verified,
          u.last_login,
          
          up.id as profile_id,
          up.restaurant_id,
          up.phone,
          up.avatar_url,
          up.settings,
          
          r.name as role_name,
          r.display_name as role_display_name,
          r.permissions,
          
          rest.name as restaurant_name,
          rest.slug as restaurant_slug
          
        FROM users u
        INNER JOIN user_profiles up ON u.id = up.user_id
        INNER JOIN roles r ON up.role_id = r.id
        LEFT JOIN restaurants rest ON up.restaurant_id = rest.id
        WHERE u.email = $1 AND u.is_active = true`,
        [email],
        'find_user_by_email_with_profile'
      );

      if (result.rows.length === 0) {
        return null;
      }

      const userData = result.rows[0];

      return {
        id: userData.user_id,
        email: userData.email,
        password_hash: userData.password_hash,
        first_name: userData.first_name,
        last_name: userData.last_name,
        is_active: userData.is_active,
        email_verified: userData.email_verified,
        last_login: userData.last_login,
        profile: {
          id: userData.profile_id,
          restaurant_id: userData.restaurant_id,
          phone: userData.phone,
          avatar_url: userData.avatar_url,
          settings: userData.settings,
          role: {
            name: userData.role_name,
            display_name: userData.role_display_name,
            permissions: userData.permissions
          },
          restaurant: userData.restaurant_name ? {
            name: userData.restaurant_name,
            slug: userData.restaurant_slug
          } : null
        }
      };

    } catch (error) {
      logger.error('Error buscando usuario por email:', error);
      throw new DatabaseError('Error al buscar usuario', error);
    }
  }

  /**
   * Actualiza último login del usuario
   * @param {string} userId - ID del usuario
   * @returns {Promise<void>}
   */
  static async updateLastLogin(userId) {
    try {
      await query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [userId],
        'update_last_login'
      );

      logger.debug('Último login actualizado', { userId });

    } catch (error) {
      logger.error('Error actualizando último login:', error);
      // No lanzamos error para no interrumpir el login
    }
  }

  /**
   * Verifica contraseña
   * @param {string} plainPassword - Contraseña en texto plano
   * @param {string} hashedPassword - Contraseña hasheada
   * @returns {Promise<boolean>} True si la contraseña es correcta
   */
  static async verifyPassword(plainPassword, hashedPassword) {
    try {
      return await bcrypt.compare(plainPassword, hashedPassword);
    } catch (error) {
      logger.error('Error verificando contraseña:', error);
      return false;
    }
  }
}

module.exports = User;