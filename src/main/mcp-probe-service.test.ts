import type { McpServerConfig } from '../shared/agent-types'
import { isAuthError, toErrorMessage } from './mcp-probe-service'

const httpConfig: McpServerConfig = { name: 'test', type: 'http', scope: 'project', url: 'https://example.com' }
const sseConfig: McpServerConfig = { name: 'test', type: 'sse', scope: 'project', url: 'https://example.com' }
const stdioConfig: McpServerConfig = { name: 'test', type: 'stdio', scope: 'project', command: 'node' }

describe('isAuthError', () => {
  it('should return true for HTTP transport with 401 status', () => {
    expect(isAuthError(httpConfig, 'Request failed with status 401')).toBe(true)
  })

  it('should return true for HTTP transport with 403 status', () => {
    expect(isAuthError(httpConfig, 'HTTP 403 Forbidden')).toBe(true)
  })

  it('should return true for SSE transport with 401 status', () => {
    expect(isAuthError(sseConfig, 'Received 401 Unauthorized')).toBe(true)
  })

  it('should return true for SSE transport with 403 status', () => {
    expect(isAuthError(sseConfig, '403 Access Denied')).toBe(true)
  })

  it('should return false for stdio transport even with auth error message', () => {
    expect(isAuthError(stdioConfig, '401 Unauthorized')).toBe(false)
    expect(isAuthError(stdioConfig, 'unauthorized')).toBe(false)
  })

  it('should return false for HTTP transport with non-auth errors', () => {
    expect(isAuthError(httpConfig, 'Internal Server Error 500')).toBe(false)
    expect(isAuthError(httpConfig, 'Connection timeout')).toBe(false)
    expect(isAuthError(httpConfig, 'ECONNREFUSED')).toBe(false)
  })

  it('should return true for "unauthorized" keyword (case-insensitive)', () => {
    expect(isAuthError(httpConfig, 'Unauthorized access')).toBe(true)
    expect(isAuthError(httpConfig, 'UNAUTHORIZED')).toBe(true)
  })

  it('should return true for "forbidden" keyword', () => {
    expect(isAuthError(httpConfig, 'Forbidden resource')).toBe(true)
  })

  it('should return true for "oauth" keyword', () => {
    expect(isAuthError(httpConfig, 'OAuth token expired')).toBe(true)
  })

  it('should return true for "authorization" keyword', () => {
    expect(isAuthError(httpConfig, 'Missing Authorization header')).toBe(true)
  })

  it('should not match 401/403 embedded in larger numbers', () => {
    expect(isAuthError(httpConfig, 'Error code 14012')).toBe(false)
    expect(isAuthError(httpConfig, 'Port 24013')).toBe(false)
    expect(isAuthError(httpConfig, 'ID 5401')).toBe(false)
    expect(isAuthError(httpConfig, 'Code 4031')).toBe(false)
  })

  it('should match 401/403 at start or end of string', () => {
    expect(isAuthError(httpConfig, '401')).toBe(true)
    expect(isAuthError(httpConfig, '403')).toBe(true)
    expect(isAuthError(httpConfig, '401 error')).toBe(true)
    expect(isAuthError(httpConfig, 'error 403')).toBe(true)
  })

  it('should return false for empty message', () => {
    expect(isAuthError(httpConfig, '')).toBe(false)
  })
})

describe('toErrorMessage', () => {
  it('should return message from Error instance', () => {
    expect(toErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('should return string as-is', () => {
    expect(toErrorMessage('raw error')).toBe('raw error')
  })

  it('should stringify objects via String()', () => {
    expect(toErrorMessage({ code: 42 })).toBe('[object Object]')
  })

  it('should handle null', () => {
    expect(toErrorMessage(null)).toBe('null')
  })

  it('should handle undefined', () => {
    expect(toErrorMessage(undefined)).toBe('undefined')
  })

  it('should handle number', () => {
    expect(toErrorMessage(500)).toBe('500')
  })

  it('should use Error.message over toString', () => {
    const err = new Error('the message')
    err.toString = () => 'custom toString'
    expect(toErrorMessage(err)).toBe('the message')
  })

  it('should fall back to String() for Error with empty message', () => {
    const err = new Error('')
    expect(toErrorMessage(err)).toBe(String(err))
  })
})
