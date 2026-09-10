import { expect, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { RepoOwnerAvatar } from './repo-owner-avatar'

const URI = 'https://github.com/expo.png?size=80'
const OTHER = 'https://github.com/anthropics.png?size=80'

test('an avatar starts as a skeleton, not the owner initial', async () => {
  await renderWithTheme(<RepoOwnerAvatar owner="expo" uri={URI} />)
  expect(screen.getByTestId('repo-owner-avatar-skeleton')).toBeTruthy()
  expect(screen.queryByText('E')).toBeNull()
})

test('a loaded image replaces the skeleton', async () => {
  await renderWithTheme(<RepoOwnerAvatar owner="expo" uri={URI} />)
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'load') })
  expect(screen.queryByTestId('repo-owner-avatar-skeleton')).toBeNull()
  expect(screen.queryByText('E')).toBeNull()
})

test('a failed load falls back to the owner initial', async () => {
  await renderWithTheme(<RepoOwnerAvatar owner="expo" uri={URI} />)
  await act(async () => {
    fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'error', { nativeEvent: { error: 'Offline' } })
  })
  expect(screen.queryByTestId('repo-owner-avatar-skeleton')).toBeNull()
  expect(screen.getByText('E')).toBeTruthy()
})

test('a pinned loading face stays a skeleton after the image loads', async () => {
  await renderWithTheme(<RepoOwnerAvatar owner="expo" uri={URI} status="loading" />)
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'load') })
  expect(screen.getByTestId('repo-owner-avatar-skeleton')).toBeTruthy()
})

test('a new uri returns to the skeleton, not the previous face', async () => {
  const { rerender } = await renderWithTheme(<RepoOwnerAvatar owner="expo" uri={URI} />)
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'load') })
  await rerender(<RepoOwnerAvatar owner="anthropics" uri={OTHER} />)
  expect(screen.getByTestId('repo-owner-avatar-skeleton')).toBeTruthy()
  expect(screen.queryByText('A')).toBeNull()
  expect(screen.queryByText('E')).toBeNull()
})
