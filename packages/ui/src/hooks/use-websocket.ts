import { useCallback, useEffect, useRef, useState } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected';

export interface UseWebSocketOptions {
	/**
	 * Automatically reconnect on disconnect.
	 * @default true
	 */
	reconnect?: boolean;
	/**
	 * Reconnection delay in milliseconds.
	 * @default 3000
	 */
	reconnectDelay?: number;
	/**
	 * Maximum reconnection attempts.
	 * @default 5
	 */
	maxReconnectAttempts?: number;
	/**
	 * Callback when connection opens.
	 */
	onOpen?: (event: Event) => void;
	/**
	 * Callback when connection closes.
	 */
	onClose?: (event: CloseEvent) => void;
	/**
	 * Callback when an error occurs.
	 */
	onError?: (event: Event) => void;
	/**
	 * Callback when a message is received.
	 */
	onMessage?: (event: MessageEvent) => void;
}

export interface UseWebSocketReturn<T = unknown> {
	/**
	 * Current connection status.
	 */
	status: WebSocketStatus;
	/**
	 * Last received message (parsed as JSON if possible).
	 */
	lastMessage: T | null;
	/**
	 * Send a message through the WebSocket.
	 */
	send: (data: string | object) => void;
	/**
	 * Manually connect to the WebSocket.
	 */
	connect: () => void;
	/**
	 * Manually disconnect from the WebSocket.
	 */
	disconnect: () => void;
}

/**
 * Hook for managing WebSocket connections with auto-reconnect.
 *
 * @example
 * ```tsx
 * const { status, lastMessage, send } = useWebSocket<LogEntry>(
 *   'ws://localhost:3000/ws',
 *   {
 *     onMessage: (event) => console.log('Received:', event.data),
 *   }
 * );
 *
 * // Send a message
 * send({ type: 'subscribe', channel: 'logs' });
 *
 * // Check connection status
 * if (status === 'connected') {
 *   // ...
 * }
 * ```
 */
export function useWebSocket<T = unknown>(
	url: string | null,
	options: UseWebSocketOptions = {},
): UseWebSocketReturn<T> {
	const {
		reconnect = true,
		reconnectDelay = 3000,
		maxReconnectAttempts = 5,
		onOpen,
		onClose,
		onError,
		onMessage,
	} = options;

	const [status, setStatus] = useState<WebSocketStatus>('disconnected');
	const [lastMessage, setLastMessage] = useState<T | null>(null);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const connect = useCallback(() => {
		if (!url || wsRef.current?.readyState === WebSocket.OPEN) {
			return;
		}

		// Clean up existing connection
		if (wsRef.current) {
			wsRef.current.close();
		}

		setStatus('connecting');

		const ws = new WebSocket(url);

		ws.onopen = (event) => {
			setStatus('connected');
			reconnectAttemptsRef.current = 0;
			onOpen?.(event);
		};

		ws.onclose = (event) => {
			setStatus('disconnected');
			onClose?.(event);

			// Attempt reconnection if enabled
			if (
				reconnect &&
				!event.wasClean &&
				reconnectAttemptsRef.current < maxReconnectAttempts
			) {
				reconnectAttemptsRef.current += 1;
				reconnectTimeoutRef.current = setTimeout(() => {
					connect();
				}, reconnectDelay);
			}
		};

		ws.onerror = (event) => {
			onError?.(event);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as T;
				setLastMessage(data);
			} catch {
				setLastMessage(event.data as unknown as T);
			}
			onMessage?.(event);
		};

		wsRef.current = ws;
	}, [
		url,
		reconnect,
		reconnectDelay,
		maxReconnectAttempts,
		onOpen,
		onClose,
		onError,
		onMessage,
	]);

	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		if (wsRef.current) {
			wsRef.current.close(1000, 'Manual disconnect');
			wsRef.current = null;
		}

		reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect
		setStatus('disconnected');
	}, [maxReconnectAttempts]);

	const send = useCallback((data: string | object) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			const message = typeof data === 'string' ? data : JSON.stringify(data);
			wsRef.current.send(message);
		} else {
		}
	}, []);

	// Connect on mount if URL is provided
	useEffect(() => {
		if (url) {
			connect();
		}

		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close(1000, 'Component unmount');
			}
		};
	}, [url, connect]);

	return {
		status,
		lastMessage,
		send,
		connect,
		disconnect,
	};
}

export default useWebSocket;
