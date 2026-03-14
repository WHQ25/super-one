const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

document.addEventListener('scroll', (e) => {
  const target = e.target as Element
  if (target === document) return

  target.classList.add('is-scrolling')

  const prev = timers.get(target)
  if (prev) clearTimeout(prev)

  timers.set(target, setTimeout(() => {
    target.classList.remove('is-scrolling')
    timers.delete(target)
  }, 800))
}, true)
