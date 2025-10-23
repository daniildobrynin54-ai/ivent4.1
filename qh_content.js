// qh_content.js - Оптимизированная версия
'use strict';

/**
 * @fileoverview Контентный скрипт для визуального выделения правильных ответов в квизах
 * Получает данные от inject.js и подсвечивает соответствующие элементы
 */

(() => {
  // ==================== КОНФИГУРАЦИЯ ====================
  
  const CONFIG = {
    DEBUG: false,
    MESSAGE_SOURCE: 'quiz-helper',
    MESSAGE_TYPE: 'CORRECT',
    
    // CSS классы
    CSS: {
      CORRECT_CLASS: 'quiz-helper-correct',
      STYLE_ID: 'quiz-helper-styles'
    },
    
    // Селекторы для поиска элементов ответов
    ANSWER_SELECTORS: [
      'button',
      'a',
      'li',
      '[role="button"]',
      '.btn',
      '.answer',
      '.option',
      '.list-group-item',
      '.quiz__answer',
      '.quiz-answer'
    ].join(', '),
    
    // Паттерны атрибутов для поиска по токену
    TOKEN_ATTRIBUTES: [
      'data-token',
      'data-id',
      'data-answer-id',
      'data-key',
      'data-value'
    ],
    
    // Лимиты для оптимизации
    LIMITS: {
      MAX_PARENT_DEPTH: 6,
      MAX_CANDIDATES: 1500,
      MAX_TEXT_ELEMENTS: 200
    },
    
    // Таймауты
    TIMEOUTS: {
      MARK_DEBOUNCE: 100
    }
  };

  // ==================== УТИЛИТЫ ====================
  
  const logger = {
    log: (...args) => {
      if (CONFIG.DEBUG) console.log('[QH][content]', ...args);
    },
    debug: (...args) => {
      if (CONFIG.DEBUG) console.debug('[QH][content]', ...args);
    },
    warn: (...args) => {
      if (CONFIG.DEBUG) console.warn('[QH][content]', ...args);
    }
  };

  /**
   * Нормализует текст для сравнения
   * @param {string} text - Текст для нормализации
   * @returns {string} - Нормализованный текст
   */
  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Безопасное экранирование для CSS селектора
   * @param {string} value - Значение для экранирования
   * @returns {string} - Экранированное значение
   */
  function cssEscape(value) {
    if (window.CSS?.escape) {
      return CSS.escape(String(value));
    }
    
    // Fallback для старых браузеров
    return String(value).replace(/[\0-\x1F\x7F"\\]/g, char => 
      '\\' + char.charCodeAt(0).toString(16) + ' '
    );
  }

  // ==================== СОСТОЯНИЕ ====================
  
  const state = {
    lastPayload: null,
    lastMarkTimestamp: 0,
    mutationScheduled: false
  };

  // ==================== ИНЪЕКЦИЯ СТИЛЕЙ ====================
  
  /**
   * Инжектирует CSS стили для подсветки
   */
  function injectStyles() {
    if (document.getElementById(CONFIG.CSS.STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = CONFIG.CSS.STYLE_ID;
    style.textContent = `
      .${CONFIG.CSS.CORRECT_CLASS} {
        outline: 3px solid #16c60c !important;
        background: rgba(22, 198, 12, 0.08) !important;
        position: relative;
      }
      .${CONFIG.CSS.CORRECT_CLASS}::after {
        content: "✓";
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: #16c60c;
        font-weight: 700;
        font-size: 16px;
        pointer-events: none;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
    logger.debug('Стили инжектированы');
  }

  // ==================== ПОИСК ЭЛЕМЕНТОВ ====================
  
  /**
   * Находит ближайший родительский элемент, являющийся ответом
   * @param {HTMLElement} element - Начальный элемент
   * @returns {HTMLElement} - Элемент ответа
   */
  function findClosestAnswer(element) {
    let node = element;
    
    for (let i = 0; i < CONFIG.LIMITS.MAX_PARENT_DEPTH && node; i++) {
      try {
        if (node.matches?.(CONFIG.ANSWER_SELECTORS)) {
          return node;
        }
      } catch (err) {
        // Игнорируем ошибки matches
      }
      
      node = node.parentElement;
    }

    return element;
  }

  /**
   * Ищет элемент по токену/ID в атрибутах
   * @param {string} token - Токен для поиска
   * @returns {HTMLElement|null} - Найденный элемент
   */
  function findByToken(token) {
    if (!token) return null;

    const escapedToken = cssEscape(token);
    
    // Создаем селектор для всех возможных атрибутов
    const selectors = CONFIG.TOKEN_ATTRIBUTES.map(attr => 
      `[${attr}="${escapedToken}"]`
    ).join(', ');

    const element = document.querySelector(selectors);
    
    if (element) {
      logger.debug('Элемент найден по токену:', token, element);
    }

    return element;
  }

  /**
   * Ищет элемент по тексту
   * @param {string} text - Текст для поиска
   * @returns {HTMLElement|null} - Найденный элемент
   */
  function findByText(text) {
    if (!text) return null;

    const normalizedSearchText = normalizeText(text);

    // Этап 1: Поиск среди элементов-кандидатов (кнопки, ссылки и т.д.)
    const candidates = Array.from(
      document.querySelectorAll(CONFIG.ANSWER_SELECTORS)
    ).slice(0, CONFIG.LIMITS.MAX_CANDIDATES);

    // Точное совпадение
    for (const element of candidates) {
      const elementText = normalizeText(element.innerText || element.textContent);
      if (elementText === normalizedSearchText) {
        return element;
      }
    }

    // Частичное совпадение
    for (const element of candidates) {
      const elementText = normalizeText(element.innerText || element.textContent);
      if (elementText.includes(normalizedSearchText)) {
        return element;
      }
    }

    // Этап 2: Поиск среди всех листовых элементов
    const allLeaves = Array.from(document.querySelectorAll('body *'))
      .filter(el => el.children.length === 0)
      .slice(0, CONFIG.LIMITS.MAX_TEXT_ELEMENTS);

    for (const element of allLeaves) {
      const elementText = normalizeText(element.innerText || element.textContent);
      if (elementText === normalizedSearchText) {
        return element;
      }
    }

    return null;
  }

  // ==================== МАРКИРОВКА ====================
  
  /**
   * Очищает предыдущую подсветку
   */
  function clearPreviousHighlight() {
    document.querySelectorAll(`.${CONFIG.CSS.CORRECT_CLASS}`).forEach(el => {
      el.classList.remove(CONFIG.CSS.CORRECT_CLASS);
    });
  }

  /**
   * Подсвечивает элемент как правильный ответ
   * @param {HTMLElement} element - Элемент для подсветки
   */
  function markAsCorrect(element) {
    if (!element) return;

    clearPreviousHighlight();

    const targetElement = findClosestAnswer(element) || element;

    try {
      targetElement.classList.add(CONFIG.CSS.CORRECT_CLASS);
      state.lastMarkTimestamp = Date.now();
      logger.debug('Элемент подсвечен:', targetElement);
    } catch (err) {
      logger.warn('Ошибка подсветки элемента:', err);
    }
  }

  /**
   * Пытается найти и подсветить правильный ответ
   */
  function tryMarkCorrectAnswer() {
    if (!state.lastPayload) return;

    let element = null;

    // Приоритет 1: Поиск по токену
    if (state.lastPayload.correctToken) {
      element = findByToken(state.lastPayload.correctToken);
    }

    // Приоритет 2: Поиск по тексту
    if (!element && state.lastPayload.correctText) {
      element = findByText(state.lastPayload.correctText);
    }

    if (element) {
      markAsCorrect(element);
      state.lastPayload = null; // Очищаем после успешной подсветки
    }
  }

  // ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
  
  /**
   * Обрабатывает сообщения от inject.js
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const message = event.data;

    if (!message || 
        message.source !== CONFIG.MESSAGE_SOURCE || 
        message.type !== CONFIG.MESSAGE_TYPE) {
      return;
    }

    logger.debug('Получены данные о правильном ответе:', message.payload);

    state.lastPayload = message.payload;
    tryMarkCorrectAnswer();
  });

  /**
   * Отслеживает изменения DOM для повторного поиска элемента
   */
  const mutationObserver = new MutationObserver(() => {
    if (!state.mutationScheduled) {
      state.mutationScheduled = true;

      requestAnimationFrame(() => {
        state.mutationScheduled = false;

        // Повторная попытка только если прошло достаточно времени
        if (Date.now() - state.lastMarkTimestamp > CONFIG.TIMEOUTS.MARK_DEBOUNCE) {
          tryMarkCorrectAnswer();
        }
      });
    }
  });

  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true
  });

  // ==================== FALLBACK ДЛЯ ИНЪЕКЦИИ ====================
  
  /**
   * Fallback инъекция inject.js если динамическая регистрация не сработала
   */
  function tryInjectFallback() {
    try {
      if (window.__QH_PAGE_INSTALLED) return;

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.async = true;

      script.onload = () => {
        logger.log('inject.js загружен (fallback)');
        script.remove();
      };

      script.onerror = () => {
        logger.warn('Ошибка загрузки inject.js (CSP?)');
        script.remove();
      };

      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      logger.warn('Ошибка fallback инъекции:', err);
    }
  }

  // ==================== ПУБЛИЧНЫЙ API ====================
  
  /**
   * Экспортируем функции для отладки
   */
  window.__QH = {
    findByText,
    findByToken,
    markAsCorrect,
    tryInjectFallback
  };

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  
  injectStyles();
  logger.log('Скрипт инициализирован');
})();