// public/js/theme.js - 主题管理模块

(function() {
    'use strict';
  
    // 主题配置
    const THEMES = {
      dark: {
        id: 'dark',
        name: '深色主题',
        icon: '🌙',
        css: null, // 默认就是深色，无需额外 CSS
        description: '经典深色专业主题'
      },
      light: {
        id: 'light',
        name: '明亮主题',
        icon: '☀️',
        css: 'css/frutiger-metro.css',
        description: 'Frutiger Metro 明亮风格'
      },
      win98: {
        id: 'win98',
        name: 'Win98 主题',
        icon: '🪟',
        css: 'css/win98-windows.css',
        description: 'Windows 98 复古窗口风格'
      }
    };
  
    let currentTheme = 'dark';
    let loadedStyles = {};
  
    // 从 localStorage 读取主题偏好
    function loadThemePreference() {
      try {
        const saved = localStorage.getItem('pa_theme');
        if (saved && THEMES[saved]) {
          currentTheme = saved;
          return saved;
        }
      } catch (e) {}
      return 'dark';
    }
  
    // 保存主题偏好
    function saveThemePreference(themeId) {
      try {
        localStorage.setItem('pa_theme', themeId);
      } catch (e) {}
    }
  
    // 加载 CSS 文件
    function loadCSS(href) {
      return new Promise((resolve, reject) => {
        // 检查是否已加载
        const existing = document.querySelector(`link[href="${href}"]`);
        if (existing) {
          resolve(existing);
          return;
        }
  
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve(link);
        link.onerror = () => reject(new Error(`Failed to load ${href}`));
        document.head.appendChild(link);
      });
    }
  
    // 移除 CSS 文件
    function removeCSS(href) {
      const links = document.querySelectorAll(`link[href="${href}"]`);
      links.forEach(link => link.remove());
    }
  
    // 应用主题
    async function applyTheme(themeId, options = {}) {
      const theme = THEMES[themeId];
      if (!theme) {
        console.warn(`Theme "${themeId}" not found`);
        return false;
      }
  
      const { silent = false } = options;
  
      try {
        // 如果当前主题有 CSS，先移除
        const currentThemeObj = THEMES[currentTheme];
        if (currentThemeObj && currentThemeObj.css && currentTheme !== themeId) {
          removeCSS(currentThemeObj.css);
        }
  
        // 加载新主题的 CSS（如果有）
        if (theme.css) {
          await loadCSS(theme.css);
        }
  
        // 更新当前主题
        currentTheme = themeId;
        saveThemePreference(themeId);
  
        // 更新 body 类名
        document.body.classList.remove('theme-dark', 'theme-light', 'theme-win98');
        document.body.classList.add('theme-' + themeId);
  
        // 触发主题切换事件
        const event = new CustomEvent('themeChanged', { 
          detail: { theme: themeId, themeObj: theme }
        });
        document.dispatchEvent(event);
  
        // 更新 UI（如果存在主题切换按钮）
        updateThemeUI(themeId);
  
        if (!silent) {
          console.log(`🎨 主题已切换: ${theme.name}`);
        }
  
        return true;
      } catch (err) {
        console.error('主题切换失败:', err);
        return false;
      }
    }
  
    // 更新主题切换 UI
    function updateThemeUI(themeId) {
      // 更新设置卡片中的主题选择器
      const selector = document.getElementById('themeSelector');
      if (selector) {
        selector.value = themeId;
      }
  
      // 更新主题预览标签
      const preview = document.getElementById('themePreview');
      if (preview) {
        const theme = THEMES[themeId];
        if (theme) {
          preview.textContent = `${theme.icon} ${theme.name}`;
        }
      }
    }
  
    // 获取当前主题信息
    function getCurrentTheme() {
      return {
        id: currentTheme,
        ...THEMES[currentTheme]
      };
    }
  
    // 获取所有主题列表
    function getThemes() {
      return Object.values(THEMES);
    }
  
    // 初始化主题系统
    async function initTheme() {
      const savedTheme = loadThemePreference();
      
      // 应用保存的主题
      await applyTheme(savedTheme, { silent: true });
  
      // 绑定设置卡片中的主题选择器
      bindThemeSelector();
  
      console.log('🎨 主题系统已初始化，当前主题:', savedTheme);
    }
  
    // 绑定主题选择器事件
    function bindThemeSelector() {
      const selector = document.getElementById('themeSelector');
      if (!selector) return;
  
      // 设置当前值
      selector.value = currentTheme;
  
      // 监听变化
      selector.addEventListener('change', function(e) {
        const themeId = this.value;
        if (themeId && THEMES[themeId]) {
          applyTheme(themeId);
          // 播放点击音效
          if (window.SFX) {
            window.SFX.select();
          }
        }
      });
  
      // 也支持点击预览标签切换
      const preview = document.getElementById('themePreview');
      if (preview) {
        preview.addEventListener('click', function() {
          const themeIds = Object.keys(THEMES);
          const currentIndex = themeIds.indexOf(currentTheme);
          const nextIndex = (currentIndex + 1) % themeIds.length;
          const nextTheme = themeIds[nextIndex];
          if (nextTheme && THEMES[nextTheme]) {
            selector.value = nextTheme;
            applyTheme(nextTheme);
            if (window.SFX) {
              window.SFX.select();
            }
          }
        });
        preview.style.cursor = 'pointer';
        preview.title = '点击切换主题';
      }
    }
  
    // 暴露全局 API
    window.Theme = {
      THEMES,
      applyTheme,
      getCurrentTheme,
      getThemes,
      initTheme,
      loadThemePreference,
      saveThemePreference
    };
  
    // 自动初始化（在 DOM 加载完成后）
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTheme);
    } else {
      initTheme();
    }
  
  })();