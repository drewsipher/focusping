/**
 * Simple Google Analytics 4 for Chrome Extensions
 * Uses Measurement Protocol - no external scripts needed
 */

const MEASUREMENT_ID = 'G-BZ4JHSJGE7';
const API_KEY = 'gWFdP6-hSpiRKsolqx_2RA'; 

const ENABLED = API_KEY.length > 0;

let clientId: string | null = null;

/**
 * Get or generate a unique anonymous user ID
 */
async function getClientId(): Promise<string> {
  if (clientId) return clientId;

  try {
    const stored = await chrome.storage.local.get('analytics_client_id');
    if (stored.analytics_client_id) {
      clientId = stored.analytics_client_id as string;
      return clientId;
    }
  } catch (e) {
    // Ignore errors
  }

  // Generate new UUID
  clientId = crypto.randomUUID();
  
  try {
    await chrome.storage.local.set({ analytics_client_id: clientId });
  } catch (e) {
    // Ignore errors
  }

  return clientId;
}

/**
 * Send an event to Google Analytics
 */
export async function trackEvent(
  eventName: string, 
  params?: Record<string, string | number>
): Promise<void> {
  if (!ENABLED) {
    console.log('[Analytics] Not configured - skipping:', eventName);
    return;
  }

  try {
    const client_id = await getClientId();
    
    const payload = {
      client_id,
      events: [{
        name: eventName,
        params: params || {},
      }],
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_KEY}`;

    console.log('[Analytics] Sending:', {
      url: url.replace(API_KEY, 'API_SECRET_HIDDEN'),
      payload,
      eventName,
      params
    });

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    console.log('[Analytics] Response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[Analytics] Error response:', text);
    }
  } catch (error) {
    console.error('[Analytics] Error:', error);
  }
}

/**
 * Track a page view
 */
export async function trackPageView(pagePath: string, pageTitle: string): Promise<void> {
  await trackEvent('page_view', {
    page_path: pagePath,
    page_title: pageTitle,
  });
}
