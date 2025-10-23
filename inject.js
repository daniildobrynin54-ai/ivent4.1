// inject.js - Оптимизированная версия
'use strict';

/**
 * @fileoverview Перехват API запросов для извлечения правильных ответов в квизах
 * Работает в контексте страницы (MAIN world) для доступа к нативным API
 */

(() => {
  // ==================== МАРКЕР УСТАНОВКИ ====================
  
  try {
    window.__QH_PAGE_INSTALLED = true;
  } catch (err) {
    // Игнорируем ошибки установки маркера
  }

  // ==================== КОНФИГУРАЦИЯ ====================
  
  const CONFIG = {
    DEBUG: false,
    MESSAGE_SOURCE: 'quiz-helper',
    MESSAGE_TYPE: 'CORRECT',
    
    // Паттерны для поиска правильных ответов в данных
    PATTERNS: {
      TEXT: /(correct|right|true).*(text|answer)|correct_text|correctanswer|right_text|answer_true_text/i,
      TOKEN: /(token|id|answer.*id|answer_token)/i
    },
    
    // Типы данных для обработки
    CONTENT_TYPES: {
      JSON: 'application/json'
    },
    
    // Socket.io префиксы
    SOCKETIO_PREFIX: '42'
  };

  // ==================== УТИЛИТЫ ====================
  
  const logger = {
    debug: (...args) => {
      if (CONFIG.DEBUG) console.debug('[QH][inject]', ...args);
    },
    warn: (...args) => {
      if (CONFIG.DEBUG) console.warn('[QH][inject]', ...args);
    }
  };

  /**
   * Отправляет сообщение в qh_content.js через postMessage
   * @param {Object} info - Информация о правильном ответе
   */
  function postCorrectAnswer(info) {
    try {
      window.postMessage({
        source: CONFIG.MESSAGE_SOURCE,
        type: CONFIG.MESSAGE_TYPE,
        payload: info
      }, '*');
      
      logger.debug('Найден правильный ответ:', info);
    } catch (err) {
      logger.warn('Ошибка отправки сообщения:', err);
    }
  }

  // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ====================
  
  /**
   * Рекурсивно извлекает информацию о правильном ответе из объекта
   * @param {*} data - Данные для анализа
   * @returns {Object|null} - {correctText, correctToken} или null
   */
  function extractCorrectInfo(data) {
    if (!data || typeof data !== 'object') return null;

    let correctText = null;
    let correctToken = null;

    /**
     * Рекурсивный обход объекта
     */
    function walkObject(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Обработка массивов
      if (Array.isArray(obj)) {
        for (const item of obj) {
          walkObject(item);
        }
        return;
      }

      // Обработка объектов
      for (const [key, value] of Object.entries(obj)) {
        // Поиск текста правильного ответа
        if (CONFIG.PATTERNS.TEXT.test(key)) {
          if (typeof value === 'string' && !correctText) {
            correctText = value;
          }
        }

        // Поиск токена/ID правильного ответа
        if (CONFIG.PATTERNS.TOKEN.test(key)) {
          if ((typeof value === 'string' || typeof value === 'number') && !correctToken) {
            correctToken = String(value);
          }
        }

        // Рекурсивный обход вложенных объектов
        if (typeof value === 'object' && value !== null) {
          walkObject(value);
        }
      }
    }

    walkObject(data);

    // Возвращаем результат, если что-то найдено
    if (correctText || correctToken) {
      return { correctText, correctToken };
    }

    return null;
  }

  // ==================== ПЕРЕХВАТ FETCH ====================
  
  /**
   * Перехватывает fetch API для анализа JSON-ответов
   */
  (function interceptFetch() {
    const originalFetch = window.fetch;
    if (!originalFetch) {
      logger.warn('Fetch API недоступен');
      return;
    }

    window.fetch = async function(...args) {
      try {
        const response = await originalFetch.apply(this, args);

        // Анализ ответа
        try {
          const contentType = response.headers?.get?.('content-type') || '';
          
          if (contentType.includes(CONFIG.CONTENT_TYPES.JSON)) {
            const clonedResponse = response.clone();
            
            try {
              const data = await clonedResponse.json();
              
              if (data) {
                const info = extractCorrectInfo(data);
                if (info) postCorrectAnswer(info);
              }
            } catch (jsonErr) {
              // Игнорируем ошибки парсинга JSON
            }
          }
        } catch (analysisErr) {
          // Игнорируем ошибки анализа
        }

        return response;
      } catch (err) {
        throw err;
      }
    };

    logger.debug('Fetch API перехвачен');
  })();

  // ==================== ПЕРЕХВАТ XMLHttpRequest ====================
  
  /**
   * Перехватывает XMLHttpRequest для анализа JSON-ответов
   */
  (function interceptXHR() {
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.send = function(...args) {
      try {
        this.addEventListener('load', function handleLoad() {
          try {
            const contentType = this.getResponseHeader?.('content-type') || '';
            
            if (contentType.includes(CONFIG.CONTENT_TYPES.JSON)) {
              const responseText = this.responseText;
              
              try {
                const data = JSON.parse(responseText);
                const info = extractCorrectInfo(data);
                if (info) postCorrectAnswer(info);
              } catch (jsonErr) {
                // Игнорируем ошибки парсинга
              }
            }
          } catch (analysisErr) {
            // Игнорируем ошибки анализа
          }
        });
      } catch (listenerErr) {
        // Игнорируем ошибки добавления слушателя
      }

      return originalSend.apply(this, args);
    };

    logger.debug('XMLHttpRequest перехвачен');
  })();

  // ==================== ПЕРЕХВАТ WebSocket ====================
  
  /**
   * Перехватывает WebSocket для анализа сообщений (включая Socket.io)
   */
  (function interceptWebSocket() {
    const OriginalWebSocket = window.WebSocket;
    if (!OriginalWebSocket) {
      logger.warn('WebSocket API недоступен');
      return;
    }

    try {
      /**
       * Обертка над WebSocket
       */
      class InterceptedWebSocket extends OriginalWebSocket {
        constructor(...args) {
          super(...args);

          // Перехват входящих сообщений
          this.addEventListener?.('message', (event) => {
            try {
              parseSocketMessage(event.data);
            } catch (err) {
              // Игнорируем ошибки парсинга
            }
          });
        }
      }

      // Копирование статических свойств
      Object.getOwnPropertyNames(OriginalWebSocket).forEach(name => {
        try {
          InterceptedWebSocket[name] = OriginalWebSocket[name];
        } catch (err) {
          // Игнорируем ошибки копирования
        }
      });

      window.WebSocket = InterceptedWebSocket;
      logger.debug('WebSocket перехвачен');
    } catch (err) {
      logger.warn('Ошибка перехвата WebSocket:', err);
    }

    /**
     * Парсит сообщение WebSocket/Socket.io
     * @param {*} data - Данные сообщения
     */
    function parseSocketMessage(data) {
      if (typeof data !== 'string') return;

      // Обработка Socket.io формата (42["event", {...}])
      if (data.startsWith(CONFIG.SOCKETIO_PREFIX) && data.includes('[')) {
        try {
          const jsonPart = data.slice(data.indexOf('['));
          const array = JSON.parse(jsonPart);

          for (const item of array) {
            if (item && typeof item === 'object') {
              const info = extractCorrectInfo(item);
              if (info) postCorrectAnswer(info);
            }
          }
        } catch (err) {
          // Игнорируем ошибки парсинга
        }
        return;
      }

      // Обработка обычного JSON
      if (data.startsWith('{') || data.startsWith('[')) {
        try {
          const parsedData = JSON.parse(data);
          const info = extractCorrectInfo(parsedData);
          if (info) postCorrectAnswer(info);
        } catch (err) {
          // Игнорируем ошибки парсинга
        }
      }
    }
  })();

  logger.debug('Скрипт инициализирован');
})();