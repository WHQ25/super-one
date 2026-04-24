const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

document.addEventListener('scroll', (e) => {
  if (!(e.target instanceof Element)) return
  const target = e.target

  target.classList.add('is-scrolling')

  const prev = timers.get(target)
  if (prev) clearTimeout(prev)

  timers.set(target, setTimeout(() => {
    target.classList.remove('is-scrolling')
    timers.delete(target)
  }, 800))
}, true)
