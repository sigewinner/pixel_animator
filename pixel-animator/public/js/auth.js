// public/js/auth.js - 用户认证模块
// 在编辑器和画廊页加载，负责检查登录状态、显示用户信息、处理登出

(function () {
  const PA_USER_KEY = 'pa_user';

  /** 获取当前登录用户 */
  function getCurrentUser() {
    try {
      return JSON.parse(localStorage.getItem(PA_USER_KEY));
    } catch { return null; }
  }

  /** 检查是否已登录，未登录跳转到登录页 */
  function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    return user;
  }

  /** 取用户名首字作为头像文字 */
  function getAvatarText(username) {
    if (!username) return '?';
    return username.charAt(0).toUpperCase();
  }

  /** 在顶栏渲染用户信息 */
  function renderUserMenu(user) {
    const menu = document.getElementById('userMenu');
    if (!menu) return;

    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    if (avatar) avatar.textContent = getAvatarText(user.username);
    if (name) name.textContent = user.username;

    const logout = document.getElementById('btnLogout');
    if (logout) {
      logout.addEventListener('click', () => {
        localStorage.removeItem(PA_USER_KEY);
        window.location.href = 'login.html';
      });
    }
  }

  /** 生成像素 Logo（用于顶栏品牌图标） */
  function makePixelLogo(container, size) {
    if (!container) return;
    const colors = [
      '#8b5cf6','#a78bfa','#38bdf8','#7dd3fc',
      '#8b5cf6','#e4e4f0','#38bdf8','#7dd3fc',
      '#a78bfa','#e4e4f0','#e4e4f0','#38bdf8',
      '#7dd3fc','#38bdf8','#8b5cf6','#a78bfa',
    ];
    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gridTemplate = `repeat(4,1fr) / repeat(4,1fr)`;
    container.style.gap = '1px';
    container.style.borderRadius = '3px';
    container.style.overflow = 'hidden';
    colors.forEach(c => {
      const px = document.createElement('span');
      px.style.background = c;
      container.appendChild(px);
    });
  }

  window.Auth = { getCurrentUser, requireAuth, renderUserMenu, makePixelLogo };
})();
