// background.js - Оптимизированная версия
'use strict';

/**
 * @fileoverview Service Worker для расширения Mangabuff Helper
 * Обрабатывает сообщения, управляет регистрацией скриптов и валидацией
 */

// ==================== КОНСТАНТЫ ====================

const CONSTANTS = {
  VALID_ACTIONS: new Set([
    'startScrolling', 'stopScrolling', 'updateSpeed',
    'startFarm', 'stopFarm',
    'startMine', 'stopMine'
  ]),
  QUIZ_SCRIPT_ID: 'qh-main-hook',
  QUIZ_MATCHES: ['https://mangabuff.ru/quiz*', 'https://mangabuff.ru/quiz'],
  DOMAIN_PATTERN: /\b(?:^|\.)mangabuff\.ru$/i,
  ERROR_MESSAGES: {
    INVALID_MESSAGE: 'Неверное сообщение',
    UNKNOWN_ACTION: 'Неизвестное действие',
    NO_ACTIVE_TAB: 'Нет активной вкладки',
    WRONG_DOMAIN: 'Откройте mangabuff.ru',
    INVALID_URL: 'Некорректный URL вкладки',
    TAB_SEND_ERROR: 'Ошибка при отправке в вкладку',
    QUIZ_TOGGLE_ERROR: 'Ошибка при переключении квиза',
    GENERIC_ERROR: 'Ошибка'
  }
};

// ==================== УТИЛИТЫ ====================

/**
 * Промисифицированные Chrome API
 */
const chromeAsync = {
  tabs: {
    query: (opts) => new Promise(resolve => 
      chrome.tabs.query(opts, resolve)
    ),
    sendMessage: (tabId, msg) => new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, msg, resp => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(resp);
      });
    })
  },
  storage: {
    get: (keys) => new Promise(resolve => 
      chrome.storage.sync.get(keys, resolve)
    ),
    set: (obj) => new Promise(resolve => 
      chrome.storage.sync.set(obj, resolve)
    )
  },
  scripting: {
    register: (scripts) => chrome.scripting?.registerContentScripts?.(scripts),
    unregister: (opts) => chrome.scripting?.unregisterContentScripts?.(opts)
  }
};

/**
 * Логгер с префиксом
 */
const logger = {
  info: (...args) => console.log('[MBH][bg]', ...args),
  warn: (...args) => console.warn('[MBH][bg]', ...args),
  error: (...args) => console.error('[MBH][bg]', ...args),
  debug: (...args) => console.debug?.('[MBH][bg]', ...args)
};

// ==================== РЕГИСТРАЦИЯ КВИЗ-СКРИПТА ====================

/**
 * Регистрирует контентный скрипт для перехвата API квизов
 * @returns {Promise<void>}
 */
async function registerQuizContentScript() {
  if (!chrome.scripting?.registerContentScripts) {
    logger.warn('Scripting API недоступен');
    return;
  }

  try {
    // Сначала удаляем старую регистрацию (если есть)
    await chromeAsync.scripting.unregister({ 
      ids: [CONSTANTS.QUIZ_SCRIPT_ID] 
    }).catch(() => {});
    
    // Регистрируем новый скрипт
    await chromeAsync.scripting.register([{
      id: CONSTANTS.QUIZ_SCRIPT_ID,
      matches: CONSTANTS.QUIZ_MATCHES,
      js: ['inject.js'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true
    }]);
    
    logger.debug('Квиз-скрипт зарегистрирован');
  } catch (err) {
    logger.error('Ошибка регистрации квиз-скрипта:', err);
  }
}

/**
 * Удаляет регистрацию квиз-скрипта
 * @returns {Promise<void>}
 */
async function unregisterQuizContentScript() {
  if (!chrome.scripting?.unregisterContentScripts) return;
  
  try {
    await chromeAsync.scripting.unregister({ 
      ids: [CONSTANTS.QUIZ_SCRIPT_ID] 
    }).catch(() => {});
    logger.debug('Квиз-скрипт удален');
  } catch (err) {
    // Игнорируем ошибки при удалении
  }
}

/**
 * Инициализирует регистрацию квиз-скрипта при запуске
 * @returns {Promise<void>}
 */
async function initQuizRegistration() {
  try {
    const { quizHighlight } = await chromeAsync.storage.get(['quizHighlight']);
    
    if (quizHighlight) {
      await registerQuizContentScript();
    } else {
      await unregisterQuizContentScript();
    }
  } catch (err) {
    logger.warn('Ошибка инициализации квиза:', err);
  }
}

// ==================== ВАЛИДАЦИЯ ====================

/**
 * Валидирует сообщение
 * @param {Object} msg - Сообщение для валидации
 * @returns {Object} - {valid: boolean, error?: string}
 */
function validateMessage(msg) {
  if (!msg || typeof msg.action !== 'string') {
    return { 
      valid: false, 
      error: CONSTANTS.ERROR_MESSAGES.INVALID_MESSAGE 
    };
  }
  return { valid: true };
}

/**
 * Валидирует URL вкладки
 * @param {string} url - URL для проверки
 * @returns {Object} - {valid: boolean, error?: string}
 */
function validateTabUrl(url) {
  try {
    const urlObj = new URL(url);
    if (!CONSTANTS.DOMAIN_PATTERN.test(urlObj.hostname)) {
      return { 
        valid: false, 
        error: CONSTANTS.ERROR_MESSAGES.WRONG_DOMAIN 
      };
    }
    return { valid: true };
  } catch (err) {
    return { 
      valid: false, 
      error: CONSTANTS.ERROR_MESSAGES.INVALID_URL 
    };
  }
}

/**
 * Безопасная нормализация скорости прокрутки
 * @param {*} speed - Значение скорости
 * @returns {number} - Безопасное значение
 */
function normalizeSpeed(speed) {
  const num = Number(speed);
  return Number.isFinite(num) ? Math.max(1, Math.floor(num)) : 50;
}

// ==================== ОБРАБОТЧИКИ ДЕЙСТВИЙ ====================

/**
 * Обрабатывает действие setQuiz
 * @param {Object} msg - Сообщение с параметрами
 * @returns {Promise<Object>} - Результат операции
 */
async function handleSetQuiz(msg) {
  try {
    const enabled = Boolean(msg.enabled);
    await chromeAsync.storage.set({ quizHighlight: enabled });
    
    if (enabled) {
      await registerQuizContentScript();
    } else {
      await unregisterQuizContentScript();
    }
    
    return { success: true };
  } catch (err) {
    logger.error('Ошибка переключения квиза:', err);
    return { 
      success: false, 
      error: err?.message || CONSTANTS.ERROR_MESSAGES.QUIZ_TOGGLE_ERROR 
    };
  }
}

/**
 * Обрабатывает действие updateSpeed
 * @param {Object} msg - Сообщение с параметрами
 * @returns {Promise<Object>} - Результат операции
 */
async function handleUpdateSpeed(msg) {
  const safeSpeed = normalizeSpeed(msg.speed);
  await chromeAsync.storage.set({ scrollSpeed: safeSpeed });
  return { success: true };
}

/**
 * Обрабатывает стандартные действия (пересылка в content script)
 * @param {Object} msg - Сообщение с параметрами
 * @returns {Promise<Object>} - Результат операции
 */
async function handleStandardAction(msg) {
  // Валидация действия
  if (!CONSTANTS.VALID_ACTIONS.has(msg.action)) {
    return { 
      success: false, 
      error: CONSTANTS.ERROR_MESSAGES.UNKNOWN_ACTION 
    };
  }

  // Получение активной вкладки
  const tabs = await chromeAsync.tabs.query({ 
    active: true, 
    currentWindow: true 
  });
  
  const tab = tabs?.[0];
  if (!tab) {
    return { 
      success: false, 
      error: CONSTANTS.ERROR_MESSAGES.NO_ACTIVE_TAB 
    };
  }

  // Валидация URL
  const urlValidation = validateTabUrl(tab.url);
  if (!urlValidation.valid) {
    return { success: false, error: urlValidation.error };
  }

  // Отправка сообщения в content script
  try {
    const response = await chromeAsync.tabs.sendMessage(tab.id, msg);
    return response || { success: true };
  } catch (err) {
    logger.error('Ошибка отправки в вкладку:', err);
    return { 
      success: false, 
      error: err?.message || CONSTANTS.ERROR_MESSAGES.TAB_SEND_ERROR 
    };
  }
}

// ==================== ГЛАВНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ====================

/**
 * Обрабатывает входящие сообщения от popup/content scripts
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Валидация сообщения
      const validation = validateMessage(msg);
      if (!validation.valid) {
        sendResponse({ success: false, error: validation.error });
        return;
      }

      // Роутинг по типу действия
      let result;
      
      if (msg.action === 'setQuiz') {
        result = await handleSetQuiz(msg);
      } else if (msg.action === 'updateSpeed') {
        result = await handleUpdateSpeed(msg);
      } else {
        result = await handleStandardAction(msg);
      }

      sendResponse(result);
    } catch (err) {
      logger.error('Необработанная ошибка:', err);
      sendResponse({ 
        success: false, 
        error: err?.message || CONSTANTS.ERROR_MESSAGES.GENERIC_ERROR 
      });
    }
  })();

  return true; // Асинхронный ответ
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

// Регистрация обработчиков событий жизненного цикла
chrome.runtime.onInstalled.addListener(initQuizRegistration);
chrome.runtime.onStartup.addListener(initQuizRegistration);

// Немедленная инициализация
initQuizRegistration().catch(err => 
  logger.error('Ошибка начальной инициализации:', err)
);

logger.info('Service Worker загружен');