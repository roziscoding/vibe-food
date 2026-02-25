function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '').trim()

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 0, g: 0, b: 0 }
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

function createSoftBadgeStyle(hex: string) {
  const { r, g, b } = hexToRgb(hex)

  return {
    color: hex,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.14)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.26)`
  }
}

export const CALORIE_COLORS = {
  progress: {
    underGoal: 'primary',
    overGoal: 'warning'
  }
} as const

export const MACRO_COLORS = {
  protein: {
    badge: 'secondary',
    gauge: '#e11d48',
    solid: '#e11d48',
    badgeStyle: createSoftBadgeStyle('#e11d48')
  },
  carbs: {
    badge: 'info',
    gauge: '#2563eb',
    solid: '#2563eb',
    badgeStyle: createSoftBadgeStyle('#2563eb')
  },
  fat: {
    badge: 'warning',
    gauge: '#f59e0b',
    solid: '#f59e0b',
    badgeStyle: createSoftBadgeStyle('#f59e0b')
  }
} as const
