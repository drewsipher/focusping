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

export interface StorageHelpers {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string | string[]): Promise<void>;
  clear(): Promise<void>;
  watch<T>(key: string, callback: (newValue: T, areaName: StorageAreaName) => void): () => void;
}

function createStorageArea(areaName: StorageAreaName) {
  assertChromeApi();
  const area = chrome.storage[areaName];

  return {
    get<T>(key: string, fallback: T): Promise<T> {
      return createPromise<T>((resolve, reject) => {
        console.log("chrome storage get", areaName, key, "fallback:", fallback);
        area.get(key, (result) => {
          console.log("chrome storage get result", areaName, key, "result:", result);
          const value = result?.[key];
          const finalValue = (value !== undefined && value !== null) ? value as T : fallback;
          withLastError(resolve, reject, finalValue);
        });
      });
    },
    set<T>(key: string, value: T): Promise<void> {
      return createPromise<void>((resolve, reject) => {
        console.log("chrome storage set", areaName, key, "value:", value);
        area.set({ [key]: value }, () => {
          console.log("chrome storage set completed", areaName, key);
          withLastError(resolve, reject, undefined);
        });
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
      const listener = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
        if (changedArea === areaName && changes[key]) {
          callback(changes[key].newValue as T, areaName);
        }
      };
      
      chrome.storage.onChanged.addListener(listener);
      
      // Return unsubscribe function
      return () => {
        chrome.storage.onChanged.removeListener(listener);
      };
    },
  };
}

export interface StorageHelpers {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string | string[]): Promise<void>;
  clear(): Promise<void>;
  watch<T>(key: string, callback: (newValue: T, areaName: StorageAreaName) => void): () => void;
}

function createTabHelpers() {
  assertChromeApi();

  return {
    create(createProperties?: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
      return createPromise((resolve, reject) => {
        chrome.tabs.create(createProperties ?? {}, (tab) =>
          withLastError(resolve, reject, tab as chrome.tabs.Tab),
        );
      });
    },
    query(queryInfo: TabQueryInfo): Promise<chrome.tabs.Tab[]> {
      return createPromise((resolve, reject) => {
        chrome.tabs.query(queryInfo, (tabs) => withLastError(resolve, reject, tabs));
      });
    },
    async getActive(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
      if (typeof windowId === "number") {
        const [tab] = await this.query({ active: true, windowId });
        return tab;
      }

      let [tab] = await this.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        return tab;
      }

      [tab] = await this.query({ active: true, currentWindow: true });
      if (tab) {
        return tab;
      }

      [tab] = await this.query({ active: true });
      return tab;
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
