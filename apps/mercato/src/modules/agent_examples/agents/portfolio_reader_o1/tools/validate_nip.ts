function run(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.value !== 'string') {
    throw new Error('[internal] validate_nip requires an object with a string value')
  }

  const originalValue = args.value
  const candidate = originalValue.trim().replace(/^PL\s*/i, '')
  if (!/^[\d\s-]+$/.test(candidate)) {
    return { originalValue, value: null, checksumValid: false }
  }

  const value = candidate.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(value)) {
    return { originalValue, value: null, checksumValid: false }
  }

  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const checksum = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11
  const checksumValid = !/^(\d)\1{9}$/.test(value) && checksum !== 10 && checksum === Number(value[9])

  return { originalValue, value, checksumValid }
}
