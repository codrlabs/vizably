import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignInView from '../views/SignInView'

describe('SignInView', () => {
  it('calls onAuth with github when Continue with GitHub is clicked', () => {
    const onAuth = vi.fn()
    render(<SignInView onNav={vi.fn()} onAuth={onAuth} />)

    fireEvent.click(screen.getByRole('button', { name: /continue with github/i }))
    expect(onAuth).toHaveBeenCalledWith('github')
  })

  it('calls onAuth with google when Continue with Google is clicked', () => {
    const onAuth = vi.fn()
    render(<SignInView onNav={vi.fn()} onAuth={onAuth} />)

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(onAuth).toHaveBeenCalledWith('google')
  })

  it('navigates to terms and privacy', () => {
    const onNav = vi.fn()
    render(<SignInView onNav={onNav} onAuth={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^terms$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^privacy$/i }))
    expect(onNav).toHaveBeenCalledWith('terms')
    expect(onNav).toHaveBeenCalledWith('privacy')
  })
})
