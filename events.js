import { useEffect, useState } from 'react';

export function useEvents(baseUrl) {
  const [lastEvent, setLastEvent] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!baseUrl) return;

    const eventSource = new EventSource(`${baseUrl}/api/events`);

    eventSource.onopen = () => {
      setIsConnected(true);
      console.log('[DEBUG_LOG] SSE Connected');
    };

    eventSource.onerror = (err) => {
      setIsConnected(false);
      console.error('[DEBUG_LOG] SSE Error:', err);
    };

    const handleEvent = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEvent({ type: event.type, data, timestamp: Date.now() });
      } catch (err) {
        console.error('[DEBUG_LOG] Failed to parse SSE event data:', err);
      }
    };

    eventSource.addEventListener('requests-updated', handleEvent);
    eventSource.addEventListener('users-updated', handleEvent);

    return () => {
      eventSource.close();
    };
  }, [baseUrl]);

  return { lastEvent, isConnected };
}
