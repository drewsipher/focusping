type StorageAreaName = "sync" | "local" | "session";

type StorageGetReturn<T> = T extends string ? Record<T, unknown> : Record<string, unknown>;

type Message = Parameters<typeof chrome.runtime.sendMessage>[0];

type BadgeBackgroundColor = Parameters<typeof chrome.action.setBadgeBackgroundColor>[0];

type AlarmCreateInfo = chrome.alarms.AlarmCreateInfo;

type TabQueryInfo = chrome.tabs.QueryInfo;

function assertChromeApi() {
  if (typeof chrome === "undefined") {
    throw new Error("Chrome extension APIs are unavailable in this context.");
  }
}

function withLastError<T>(resolve: (value: T) => void, reject: (error: Error) => void, value: T) {
  const error = chrome.runtime.lastError;
  if (error) {
    reject(new Error(error.message));
    return;
  }
  resolve(value);
}

function createPromise<T>(
  executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
) {
  return new Promise<T>((resolve, reject) => {
    try {
      executor(resolve, reject);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function createStorageArea(areaName: StorageAreaName) {
  assertChromeApi();
  const area = chrome.storage[areaName];

  return {
    get<T>(key: string, fallback: T): Promise<T> {
      return createPromise<T>((resolve, reject) => {
        area.get({ [key]: fallback } as StorageGetReturn<typeof key>, (result) => {
          withLastError(resolve, reject, (result?.[key] as T) ?? fallback);
        });
      });
    },
    set<T>(key: string, value: T): Promise<void> {
      return createPromise<void>((resolve, reject) => {
        area.set({ [key]: value }, () => withLastError(resolve, reject, undefined));
      });
    },
    remove(key: string | string[]): Promise<void> {
      return createPromise<void>((resolve, reject) => {
        area.remove(key, () => withLastError(resolve, reject, undefined));
      });
    },
    clear(): Promise<void> {
      return createPromise<void>((resolve, reject) => {
        area.clear(() => withLastError(resolve, reject, undefined));
      });
    },
    watch<T>(key: string, callback: (newValue: T, areaName: StorageAreaName) => void) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === areaName && changes[key]) {
          callback(changes[key].newValue as T, areaName);
        }
      });
    },
  };
}

function createTabHelpers() {
  assertChromeApi();

  return {
    query(queryInfo: TabQueryInfo): Promise<chrome.tabs.Tab[]> {
      return createPromise((resolve, reject) => {
        chrome.tabs.query(queryInfo, (tabs) => withLastError(resolve, reject, tabs));
      });
    },
    getActive(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
      return this.query({ active: true, currentWindow: windowId === undefined, windowId }).then(
        (tabs) => tabs[0],
      );
    },
    sendMessage<T = unknown, R = unknown>(tabId: number, message: T): Promise<R | undefined> {
      return createPromise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          withLastError(resolve, reject, response as R | undefined);
        });
      });
    },
  };
}

function createAlarmHelpers() {
  assertChromeApi();

  return {
    create(name: string, info: AlarmCreateInfo): Promise<void> {
      chrome.alarms.create(name, info);
      return Promise.resolve();
    },
    clear(name: string): Promise<boolean> {
      return createPromise((resolve, reject) => {
        chrome.alarms.clear(name, (cleared) => withLastError(resolve, reject, Boolean(cleared)));
      });
    },
    clearAll(): Promise<boolean> {
      return createPromise((resolve, reject) => {
        chrome.alarms.clearAll((cleared) => withLastError(resolve, reject, Boolean(cleared)));
      });
    },
    get(name: string): Promise<chrome.alarms.Alarm | undefined> {
      return createPromise((resolve, reject) => {
        chrome.alarms.get(name, (alarm) => withLastError(resolve, reject, alarm ?? undefined));
      });
    },
    getAll(): Promise<chrome.alarms.Alarm[]> {
      return createPromise((resolve, reject) => {
        chrome.alarms.getAll((alarms) => withLastError(resolve, reject, alarms));
      });
    },
  };
}

function createNotificationHelpers() {
  assertChromeApi();

  return {
    create(
      notificationId: string,
      options: chrome.notifications.NotificationOptions<true>,
    ): Promise<string> {
      return createPromise((resolve, reject) => {
        chrome.notifications.create(notificationId, options, (id) =>
          withLastError(resolve, reject, id),
        );
      });
    },
    clear(notificationId: string): Promise<boolean> {
      return createPromise((resolve, reject) => {
        chrome.notifications.clear(notificationId, (wasCleared) =>
          withLastError(resolve, reject, Boolean(wasCleared)),
        );
      });
    },
  };
}

function createRuntimeHelpers() {
  assertChromeApi();

  return {
    sendMessage<T = Message, R = unknown>(message: T): Promise<R | undefined> {
      return createPromise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) =>
          withLastError(resolve, reject, response as R),
        );
      });
    },
    openOptionsPage(): Promise<void> {
      return createPromise((resolve, reject) => {
        chrome.runtime.openOptionsPage(() => withLastError(resolve, reject, undefined));
      });
    },
  };
}

function createActionHelpers() {
  assertChromeApi();

  return {
    setBadgeText(text: string): Promise<void> {
      return createPromise((resolve, reject) => {
        chrome.action.setBadgeText({ text }, () => withLastError(resolve, reject, undefined));
      });
    },
    setBadgeBackgroundColor(color: BadgeBackgroundColor): Promise<void> {
      return createPromise((resolve, reject) => {
        chrome.action.setBadgeBackgroundColor(color, () =>
          withLastError(resolve, reject, undefined),
        );
      });
    },
  };
}

export const tabs = createTabHelpers();
export const storage = {
  sync: createStorageArea("sync"),
  local: createStorageArea("local"),
  session: createStorageArea("session"),
};
export const alarms = createAlarmHelpers();
export const notifications = createNotificationHelpers();
export const runtime = createRuntimeHelpers();
export const action = createActionHelpers();

export function getActiveTabOrThrow(): Promise<chrome.tabs.Tab> {
  return tabs.getActive().then((tab) => {
    if (!tab) {
      throw new Error("No active tab found.");
    }
    return tab;
  });
}
