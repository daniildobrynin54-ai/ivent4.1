// popup.js - Оптимизированная версия
'use strict';

/**
 * @fileoverview UI логика для popup расширения Mangabuff Helper
 * Управление всеми функциями через интерфейс
 */

// ==================== КОНСТАНТЫ ====================

const CONFIG = {
  // Лимиты
  LIMITS: {
    MAX_COMMENTS: 100,
    MIN_INTERVAL: 1,
    MAX_INTERVAL: 100,
    MIN_TOTAL_COMMENTS: 1,
    MAX_TOTAL_COMMENTS: 100,
    MIN_CHAPTERS: 0,
    MAX_CHAPTERS: 100000,
    MIN_GIFT_DELAY: 50,
    MAX_GIFT_DELAY: 2000,
    MIN_MINE_DELAY: 0.2,
    MAX_MINE_DELAY: 5.0
  },
  
  // Таймауты
  TIMEOUTS: {
    ERROR_DISPLAY: 3200,
    SPEED_DEBOUNCE: 140,
    DELAY_DEBOUNCE: 120
  },
  
  // Высота popup
  POPUP_HEIGHT: {
    MIN: 255,
    MAX: 760,
    EXTRA_PADDING: 9
  },
  
  // Ключи хранилища
  STORAGE_KEYS: {
    AUTO_COMMENT: 'autoCommentSettings',
    AUTO_COMMENT_STATE: 'autoCommentState',
    LAST_ERROR: 'lastAutoCommentError'
  },
  
  // Дефолтные значения
  DEFAULTS: {
    ENABLED: false,
    INTERVAL: 2,
    TOTAL_COMMENTS: 5,
    COMMENTS_LIST: []
  }
};

// ==================== УТИЛИТЫ ====================

/**
 * Быстрый querySelector
 */
const $ = (selector) => document.querySelector(selector);

/**
 * Промисифицированные Chrome API
 */
const chromeAsync = {
  storage: {
    get: (keys) => new Promise(resolve => 
      chrome.storage.sync.get(keys, resolve)
    ),
    set: (obj) => new Promise(resolve => 
      chrome.storage.sync.set(obj, resolve)
    )
  },
  tabs: {
    query: (opts) => new Promise(resolve => 
      chrome.tabs.query(opts, resolve)
    )
  },
  runtime: {
    sendMessage: (msg) => new Promise(resolve => 
      chrome.runtime.sendMessage(msg, resolve)
    )
  }
};

/**
 * Клампит число в заданном диапазоне
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Безопасный парсинг числа
 */
function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// ==================== UI МЕНЕДЖЕР ====================

class UIManager {
  /**
   * Показывает ошибку в нижней панели
   */
  static showError(message) {
    const errorBar = $('#errorBar');
    errorBar.textContent = message;
    errorBar.classList.add('visible');
    
    clearTimeout(errorBar._timeout);
    errorBar._timeout = setTimeout(() => {
      errorBar.classList.remove('visible');
    }, CONFIG.TIMEOUTS.ERROR_DISPLAY);
  }

  /**
   * Устанавливает тему
   */
  static setTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    $('#themeToggle').checked = isDark;
  }

  /**
   * Открывает панель
   */
  static openPanel(panelSelector) {
    document.querySelectorAll('.section.active')
      .forEach(el => el.classList.remove('active'));
    
    $('#mainMenu').style.display = 'none';
    document.querySelector(panelSelector).classList.add('active');
    
    this.adjustPopupHeight();
  }

  /**
   * Закрывает все панели
   */
  static closePanels() {
    $('#mainMenu').style.display = '';
    document.querySelectorAll('.section.active')
      .forEach(el => el.classList.remove('active'));
    
    this.adjustPopupHeight();
  }

  /**
   * Динамически подстраивает высоту popup
   */
  static adjustPopupHeight() {
    const body = document.body;
    body.style.height = 'auto';

    const activePanel = document.querySelector('.section.active');
    const menu = $('#mainMenu');
    
    let height = 0;
    
    if (activePanel?.offsetHeight) {
      height = $('#header').offsetHeight + 
               $('#header-sep').offsetHeight + 
               activePanel.scrollHeight + 
               CONFIG.POPUP_HEIGHT.EXTRA_PADDING;
    } else {
      height = $('#header').offsetHeight + 
               $('#header-sep').offsetHeight + 
               menu.offsetHeight + 
               CONFIG.POPUP_HEIGHT.EXTRA_PADDING;
    }

    height = clamp(height, CONFIG.POPUP_HEIGHT.MIN, CONFIG.POPUP_HEIGHT.MAX);
    
    body.style.height = `${height}px`;
    document.documentElement.style.height = `${height}px`;
  }
}

// ==================== COMMENTS МЕНЕДЖЕР ====================

class CommentsManager {
  /**
   * Рендерит облако комментариев
   */
  static render(commentsList) {
    const container = $('#commentsCloud');
    container.innerHTML = '';

    (commentsList || []).forEach((comment, index) => {
      const card = this._createCommentCard(comment, index);
      container.appendChild(card);
    });
  }

  /**
   * Создает карточку комментария
   */
  static _createCommentCard(comment, index) {
    const card = document.createElement('div');
    card.className = 'comment-item';

    const textDiv = document.createElement('div');
    textDiv.className = 'comment-text';
    textDiv.textContent = comment;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'comment-del';
    deleteBtn.title = 'Удалить комментарий';
    deleteBtn.setAttribute('aria-label', 'Удалить комментарий');
    deleteBtn.dataset.index = index;
    deleteBtn.textContent = '✕';
    
    deleteBtn.addEventListener('click', () => this._handleDelete(index));

    card.appendChild(textDiv);
    card.appendChild(deleteBtn);

    return card;
  }

  /**
   * Обрабатывает удаление комментария
   */
  static async _handleDelete(index) {
    const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
    
    const settings = Object.assign(
      { ...CONFIG.DEFAULTS }, 
      data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
    );

    settings.commentsList = settings.commentsList || [];

    if (index >= 0 && index < settings.commentsList.length) {
      settings.commentsList.splice(index, 1);
      
      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });
      
      StatusManager.sync();
    }
  }

  /**
   * Добавляет новый комментарий
   */
  static async add(text) {
    if (!text?.trim()) return;

    const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
    
    const settings = Object.assign(
      { ...CONFIG.DEFAULTS }, 
      data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
    );

    settings.commentsList = settings.commentsList || [];

    if (settings.commentsList.length >= CONFIG.LIMITS.MAX_COMMENTS) {
      UIManager.showError(`Максимум ${CONFIG.LIMITS.MAX_COMMENTS} комментариев`);
      return;
    }

    settings.commentsList.push(text.trim());
    
    await chromeAsync.storage.set({ 
      [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
    });

    $('#newCommentText').value = '';
    StatusManager.sync();
  }

  /**
   * Сохраняет настройки комментирования
   */
  static async save() {
    const settings = {
      enabled: $('#autoCommentEnable').checked,
      interval: clamp(
        safeParseInt($('#commentInterval').value, CONFIG.DEFAULTS.INTERVAL),
        CONFIG.LIMITS.MIN_INTERVAL,
        CONFIG.LIMITS.MAX_INTERVAL
      ),
      totalComments: clamp(
        safeParseInt($('#commentTotal').value, CONFIG.DEFAULTS.TOTAL_COMMENTS),
        CONFIG.LIMITS.MIN_TOTAL_COMMENTS,
        CONFIG.LIMITS.MAX_TOTAL_COMMENTS
      ),
      commentsList: []
    };

    // Собираем комментарии из UI
    $('#commentsCloud').querySelectorAll('.comment-text')
      .forEach(el => settings.commentsList.push(el.textContent));

    await chromeAsync.storage.set({ 
      [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
    });

    UIManager.showError('Сохранено');
    StatusManager.sync();
  }

  /**
   * Очищает все комментарии
   */
  static async clear() {
    await chromeAsync.storage.set({
      [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: { ...CONFIG.DEFAULTS },
      [CONFIG.STORAGE_KEYS.AUTO_COMMENT_STATE]: { posted: 0 },
      [CONFIG.STORAGE_KEYS.LAST_ERROR]: ''
    });

    StatusManager.sync();
  }
}

// ==================== STATUS МЕНЕДЖЕР ====================

class StatusManager {
  /**
   * Синхронизирует состояние UI с хранилищем
   */
  static async sync() {
    const keys = [
      'autoScroll', 'farmActive', 'scrollSpeed', 'theme', 
      'mineActive', 'chapterLimit', 'chapterRead', 
      'giftClickDelay', 'mineClickDelay', 
      CONFIG.STORAGE_KEYS.AUTO_COMMENT, 
      CONFIG.STORAGE_KEYS.LAST_ERROR, 
      'quizHighlight'
    ];

    const data = await chromeAsync.storage.get(keys);

    this._updateStatusIndicators(data);
    this._updateScrollControls(data);
    this._updateFarmControls(data);
    this._updateMineControls(data);
    this._updateCommentControls(data);
    this._updateQuizToggle(data);

    UIManager.setTheme(data.theme === 'dark');

    // Показать последнюю ошибку автокомментирования
    const lastError = data[CONFIG.STORAGE_KEYS.LAST_ERROR] || '';
    if (lastError) {
      UIManager.showError(lastError);
    }
  }

  /**
   * Обновляет индикаторы статуса
   */
  static _updateStatusIndicators(data) {
    const auto = Boolean(data.autoScroll);
    const farm = Boolean(data.farmActive);
    const mine = Boolean(data.mineActive);

    this._setIndicator('autoStatus', auto, 
      'Автопрокрутка включена', 'Автопрокрутка выключена');
    this._setIndicator('farmStatus', farm, 
      'Фарм активен', 'Фарм не активен');
    this._setIndicator('mineStatus', mine, 
      'Шахта активна', 'Шахта не активна');
  }

  /**
   * Устанавливает состояние индикатора
   */
  static _setIndicator(id, isActive, activeTitle, inactiveTitle) {
    const indicator = $(`#${id}`);
    indicator.className = `status-indicator ${isActive ? 'on' : 'off'}`;
    indicator.title = isActive ? activeTitle : inactiveTitle;
  }

  /**
   * Обновляет контролы прокрутки
   */
  static _updateScrollControls(data) {
    $('#autoScrollSwitch').checked = Boolean(data.autoScroll);
    
    const speed = safeParseInt(data.scrollSpeed, 50);
    $('#scrollSpeedRange').value = speed;
    $('#scrollSpeedLabel').textContent = speed;
    
    const chapterLimit = safeParseInt(data.chapterLimit, 0);
    $('#chapterLimitInput').value = chapterLimit;
  }

  /**
   * Обновляет контролы фарма
   */
  static _updateFarmControls(data) {
    const giftDelay = safeParseInt(data.giftClickDelay, 600);
    $('#giftDelayRange').value = giftDelay;
    $('#giftDelayLabel').textContent = giftDelay;
    $('#giftDelayInput').value = giftDelay;

    $('#startFarm').disabled = Boolean(data.farmActive);
  }

  /**
   * Обновляет контролы шахты
   */
  static _updateMineControls(data) {
    const mineDelay = safeParseFloat(data.mineClickDelay, 2000) / 1000;
    $('#mineDelayRange').value = mineDelay;
    $('#mineDelayLabel').textContent = mineDelay.toFixed(1);
    $('#mineDelayInput').value = mineDelay.toFixed(1);

    $('#startMine').disabled = Boolean(data.mineActive);
  }

  /**
   * Обновляет контролы комментирования
   */
  static _updateCommentControls(data) {
    const settings = data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || { ...CONFIG.DEFAULTS };
    
    $('#autoCommentEnable').checked = Boolean(settings.enabled);
    $('#commentInterval').value = settings.interval || CONFIG.DEFAULTS.INTERVAL;
    $('#commentTotal').value = settings.totalComments || CONFIG.DEFAULTS.TOTAL_COMMENTS;
    
    CommentsManager.render(settings.commentsList || []);
  }

  /**
   * Обновляет переключатель квизов
   */
  static _updateQuizToggle(data) {
    const quizToggle = $('#quizHighlightToggle');
    if (quizToggle) {
      quizToggle.checked = Boolean(data.quizHighlight);
    }
  }
}

// ==================== ACTION МЕНЕДЖЕР ====================

class ActionManager {
  /**
   * Отправляет действие в background script
   */
  static async sendAction(action, params = {}) {
    try {
      const response = await chromeAsync.runtime.sendMessage({
        action,
        ...params
      });

      if (response?.success) {
        StatusManager.sync();
        return true;
      } else {
        UIManager.showError(response?.error || 'Ошибка');
        return false;
      }
    } catch (err) {
      UIManager.showError(err?.message || 'Ошибка соединения');
      return false;
    }
  }

  /**
   * Вычисляет необходимое количество глав
   */
  static computeNeededChapters(interval, totalComments) {
    return 2 + ((Math.max(1, totalComments) - 1) * Math.max(1, interval));
  }

  /**
   * Валидирует настройки перед запуском автопрокрутки
   */
  static async validateAutoScrollStart() {
    const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
    const settings = data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || { ...CONFIG.DEFAULTS };
    const plannedChapters = safeParseInt($('#chapterLimitInput').value, 0);

    if (!settings.enabled) return true;
    if (plannedChapters === 0) return true; // Бесконечное чтение

    const interval = Math.max(1, safeParseInt(settings.interval, 1));
    const total = Math.max(1, safeParseInt(settings.totalComments, 1));
    const needed = this.computeNeededChapters(interval, total);

    if (plannedChapters < needed) {
      UIManager.showError(
        `Для оставки ${total} комментариев с интервалом ${interval} ` +
        `требуется прочитать как минимум ${needed} глав. ` +
        `Увеличьте число глав или отключите комментирование.`
      );
      return false;
    }

    return true;
  }
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================

class EventHandlers {
  /**
   * Инициализирует все обработчики
   */
  static init() {
    this._initTheme();
    this._initNavigation();
    this._initScroll();
    this._initFarm();
    this._initMine();
    this._initComments();
    this._initQuiz();
    this._initResize();
  }

  /**
   * Тема
   */
  static _initTheme() {
    $('#themeToggle').addEventListener('change', async (e) => {
      const isDark = e.target.checked;
      UIManager.setTheme(isDark);
      await chromeAsync.storage.set({ theme: isDark ? 'dark' : 'light' });
    });
  }

  /**
   * Навигация по панелям
   */
  static _initNavigation() {
    $('#btnAuto').onclick = () => UIManager.openPanel('#autoPanel');
    $('#btnFarm').onclick = () => UIManager.openPanel('#farmPanel');
    $('#btnFuture').onclick = () => UIManager.openPanel('#commentPanel');
    
    $('#backAuto').onclick = () => UIManager.closePanels();
    $('#backFarm').onclick = () => UIManager.closePanels();
    $('#backComment').onclick = () => UIManager.closePanels();
  }

  /**
   * Автопрокрутка
   */
  static _initScroll() {
    // Переключатель автопрокрутки
    $('#autoScrollSwitch').onchange = async (e) => {
      const enabled = e.target.checked;

      if (enabled && !(await ActionManager.validateAutoScrollStart())) {
        $('#autoScrollSwitch').checked = false;
        return;
      }

      await chromeAsync.storage.set({ autoScroll: enabled });
      await ActionManager.sendAction(
        enabled ? 'startScrolling' : 'stopScrolling',
        { chapterLimit: safeParseInt($('#chapterLimitInput').value, 0) }
      );
    };

    // Слайдер скорости (с debounce)
    let speedDebounce;
    $('#scrollSpeedRange').addEventListener('input', (e) => {
      $('#scrollSpeedLabel').textContent = e.target.value;
      
      clearTimeout(speedDebounce);
      speedDebounce = setTimeout(async () => {
        const speed = safeParseInt(e.target.value, 50);
        await chromeAsync.storage.set({ scrollSpeed: speed });
        await ActionManager.sendAction('updateSpeed', { speed });
      }, CONFIG.TIMEOUTS.SPEED_DEBOUNCE);
    });

    // Лимит глав
    $('#chapterLimitInput').addEventListener('input', async (e) => {
      const value = clamp(
        safeParseInt(e.target.value, 0),
        CONFIG.LIMITS.MIN_CHAPTERS,
        CONFIG.LIMITS.MAX_CHAPTERS
      );
      e.target.value = value;
      await chromeAsync.storage.set({ chapterLimit: value });
      StatusManager.sync();
    });

    // Сброс
    $('#resetChapters').onclick = async () => {
      $('#chapterLimitInput').value = 0;
      await chromeAsync.storage.set({
        chapterLimit: 0,
        chapterRead: 0,
        currentChapterUrl: null,
        autoScroll: false
      });
      await ActionManager.sendAction('stopScrolling');
    };
  }

  /**
   * Фарм ивента
   */
  static _initFarm() {
    // Задержка подарков
    let giftDebounce;
    
    $('#giftDelayRange').addEventListener('input', (e) => {
      const value = safeParseInt(e.target.value, 600);
      $('#giftDelayLabel').textContent = value;
      $('#giftDelayInput').value = value;
      
      clearTimeout(giftDebounce);
      giftDebounce = setTimeout(async () => {
        await chromeAsync.storage.set({ giftClickDelay: value });
        StatusManager.sync();
      }, CONFIG.TIMEOUTS.DELAY_DEBOUNCE);
    });

    $('#giftDelayInput').addEventListener('change', async (e) => {
      const value = clamp(
        safeParseInt(e.target.value, 600),
        CONFIG.LIMITS.MIN_GIFT_DELAY,
        CONFIG.LIMITS.MAX_GIFT_DELAY
      );
      
      $('#giftDelayInput').value = value;
      $('#giftDelayRange').value = value;
      $('#giftDelayLabel').textContent = value;
      
      await chromeAsync.storage.set({ giftClickDelay: value });
      StatusManager.sync();
    });

    // Кнопки фарма
    $('#startFarm').onclick = async () => {
      await chromeAsync.storage.set({ farmActive: true });
      await ActionManager.sendAction('startFarm');
    };

    $('#stopFarm').onclick = async () => {
      await ActionManager.sendAction('stopFarm');
      await chromeAsync.storage.set({ farmActive: false });
      StatusManager.sync();
    };
  }

  /**
   * Фарм шахты
   */
  static _initMine() {
    // Скорость клика шахты
    let mineDebounce;
    
    $('#mineDelayRange').addEventListener('input', (e) => {
      const value = safeParseFloat(e.target.value, 2.0);
      $('#mineDelayLabel').textContent = value.toFixed(1);
      $('#mineDelayInput').value = value.toFixed(1);
      
      clearTimeout(mineDebounce);
      mineDebounce = setTimeout(async () => {
        await chromeAsync.storage.set({ mineClickDelay: Math.round(value * 1000) });
        StatusManager.sync();
      }, CONFIG.TIMEOUTS.DELAY_DEBOUNCE);
    });

    $('#mineDelayInput').addEventListener('change', async (e) => {
      const value = clamp(
        safeParseFloat(e.target.value, 2.0),
        CONFIG.LIMITS.MIN_MINE_DELAY,
        CONFIG.LIMITS.MAX_MINE_DELAY
      );
      
      $('#mineDelayInput').value = value.toFixed(1);
      $('#mineDelayRange').value = value.toFixed(1);
      $('#mineDelayLabel').textContent = value.toFixed(1);
      
      await chromeAsync.storage.set({ mineClickDelay: Math.round(value * 1000) });
      StatusManager.sync();
    });

    // Кнопки шахты
    $('#startMine').onclick = async () => {
      await chromeAsync.storage.set({ mineActive: true });
      await ActionManager.sendAction('startMine');
    };

    $('#stopMine').onclick = async () => {
      await ActionManager.sendAction('stopMine');
      await chromeAsync.storage.set({ mineActive: false });
      StatusManager.sync();
    };
  }

  /**
   * Автокомментирование
   */
  static _initComments() {
    // Переключатель (немедленное сохранение)
    $('#autoCommentEnable').addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      const data = await chromeAsync.storage.get([CONFIG.STORAGE_KEYS.AUTO_COMMENT]);
      
      const settings = Object.assign(
        { ...CONFIG.DEFAULTS }, 
        data[CONFIG.STORAGE_KEYS.AUTO_COMMENT] || {}
      );
      
      settings.enabled = enabled;
      
      await chromeAsync.storage.set({ 
        [CONFIG.STORAGE_KEYS.AUTO_COMMENT]: settings 
      });
      
      StatusManager.sync();
    });

    // Добавление комментария
    $('#addCommentBtn').onclick = () => {
      CommentsManager.add($('#newCommentText').value);
    };

    // Сохранение настроек
    $('#saveCommentsBtn').onclick = () => CommentsManager.save();

    // Очистка
    $('#clearCommentsBtn').onclick = () => CommentsManager.clear();
  }

  /**
   * Квиз
   */
  static _initQuiz() {
    const quizToggle = $('#quizHighlightToggle');
    if (!quizToggle) return;

    quizToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      
      await chromeAsync.storage.set({ quizHighlight: enabled });
      
      const response = await chromeAsync.runtime.sendMessage({
        action: 'setQuiz',
        enabled
      });

      if (!response?.success) {
        UIManager.showError(response?.error || 'Ошибка переключения квиза');
      }

      StatusManager.sync();
    });
  }

  /**
   * Изменение размера окна
   */
  static _initResize() {
    // Автоподстройка высоты при анимациях
    document.body.addEventListener('transitionend', () => 
      UIManager.adjustPopupHeight()
    );

    document.querySelectorAll('.section').forEach(panel => {
      panel.addEventListener('transitionend', () => 
        UIManager.adjustPopupHeight()
      );
    });

    window.addEventListener('resize', () => 
      UIManager.adjustPopupHeight()
    );

    // Слушатель изменений хранилища
    chrome.storage.onChanged.addListener(() => StatusManager.sync());
  }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

document.addEventListener('DOMContentLoaded', () => {
  EventHandlers.init();
  StatusManager.sync();
  UIManager.adjustPopupHeight();
});