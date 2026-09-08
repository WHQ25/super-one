import { useEffect, type ReactNode } from 'react'
import {
  createNavigationContainerRef,
  NavigationContainer,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useMobileTheme } from '../theme/context'
import { routeHierarchy, type FilesOrigin, type MobileRoute } from './route-state'

export type { FilesOrigin, MobileRoute } from './route-state'

type MobileStackParams = Record<MobileRoute, undefined>

const Stack = createNativeStackNavigator<MobileStackParams>()
const navigationRef = createNavigationContainerRef<MobileStackParams>()

function currentRouteName(state?: NavigationState | PartialState<NavigationState>): MobileRoute | undefined {
  if (!state) return undefined
  const route = state.routes[state.index ?? state.routes.length - 1]
  if (!route) return undefined
  if (route.state) return currentRouteName(route.state)
  return route.name as MobileRoute
}

export function MobileNavigator(props: {
  route: MobileRoute
  filesOrigin: FilesOrigin
  renderScene: (route: MobileRoute) => ReactNode
  onRouteChange: (route: MobileRoute) => void
}) {
  const { tokens } = useMobileTheme()
  useEffect(() => {
    if (!navigationRef.isReady() || navigationRef.getCurrentRoute()?.name === props.route) return
    const routes = routeHierarchy(props.route, props.filesOrigin)
    navigationRef.reset({ index: routes.length - 1, routes: routes.map((name) => ({ name })) })
  }, [props.filesOrigin, props.route])

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={{
        dark: tokens.scheme === 'dark',
        colors: {
          primary: tokens.colors.primary,
          background: tokens.colors.background,
          card: tokens.colors.surface,
          text: tokens.colors.foreground,
          border: tokens.colors.border,
          notification: tokens.colors.error,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '900' },
        },
      }}
      onReady={() => {
        if (props.route === 'pair') return
        const routes = routeHierarchy(props.route, props.filesOrigin)
        navigationRef.reset({ index: routes.length - 1, routes: routes.map((name) => ({ name })) })
      }}
      onStateChange={(state) => {
        const route = currentRouteName(state)
        if (route && route !== props.route) props.onRouteChange(route)
      }}
    >
      <Stack.Navigator
        initialRouteName="pair"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.colors.background },
        }}
      >
        {(Object.keys({
          pair: 1,
          chat: 1,
          'session-search': 1,
          'project-picker': 1,
          'add-project': 1,
          terminal: 1,
          worktree: 1,
          branch: 1,
          settings: 1,
          files: 1,
        }) as MobileRoute[]).map((route) => (
          <Stack.Screen
            key={route}
            name={route}
            // Chat sits directly on the device list, so the back gesture would
            // drop the connection's whole context to show a screen the user was
            // not asking for. The workspace drawer owns that edge instead, and
            // only its Disconnect button returns to the device list.
            options={route === 'chat' ? { gestureEnabled: false } : undefined}
          >
            {() => props.renderScene(route)}
          </Stack.Screen>
        ))}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
