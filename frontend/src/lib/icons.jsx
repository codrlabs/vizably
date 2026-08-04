import {
  ArrowLeft, ArrowRight, Captions, Check, ChevronDown, CircleCheck, CircleX, Clock,
  Coffee, Download, ExternalLink, Eye, EyeOff, FolderOpen, Gift, GitBranch,
  Globe, Hand, HardDrive, Heart, House, ImageOff, Keyboard, Leaf, Loader2,
  ListTree, LogOut, Mail, Moon, Navigation, Palette, Plus, RefreshCw,
  ScanLine, ShieldCheck, Sparkles, Sun, Timer, Trash2, TriangleAlert,
  User, Wrench, Zap,
} from 'lucide-react'

/**
 * GitHub mark, inlined. Lucide deprecated and then removed its brand
 * icons (`Github` is gone in lucide-react ≥ 1.0), so we ship the glyph
 * ourselves — same paths and stroke style lucide 0.456 used, so it
 * matches the rest of the icon set.
 */
function Github({ size = 24, color = 'currentColor', strokeWidth = 2, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg" {...rest}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

// Named imports (rather than `import * as lucide`) keep the lucide
// library tree-shakeable; add icons here as views need them.
const ICONS = {
  ArrowLeft, ArrowRight, Captions, Check, ChevronDown, CircleCheck, CircleX, Clock,
  Coffee, Download, ExternalLink, Eye, EyeOff, FolderOpen, Gift, GitBranch,
  Github, Globe, Hand, HardDrive, Heart, House, ImageOff, Keyboard, Leaf, Loader2,
  ListTree, LogOut, Mail, Moon, Navigation, Palette, Plus, RefreshCw,
  ScanLine, ShieldCheck, Sparkles, Sun, Timer, Trash2, TriangleAlert,
  User, Wrench, Zap,
}

/**
 * Ico — thin wrapper over lucide-react so views can request icons by
 * name, exactly as the UI kit did (`Ico('Globe', 18)`). Unknown names
 * render nothing rather than crashing.
 */
export function Ico(name, size = 18, color = 'currentColor') {
  const Icon = ICONS[name]
  if (!Icon) return null
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <Icon size={size} color={color} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

/** Multicolor Google "G" mark (brand asset — not in Lucide). */
export function GoogleMark(size = 18) {
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
        <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
        <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
        <path fill="#EA4335" d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 2.97 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
      </svg>
    </span>
  )
}
