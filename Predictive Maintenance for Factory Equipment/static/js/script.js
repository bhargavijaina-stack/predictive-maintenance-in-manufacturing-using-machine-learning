document.addEventListener('DOMContentLoaded', () => {
  const reveals = document.querySelectorAll('.fade-up');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.15 }
  );

  reveals.forEach((el) => observer.observe(el));

  const navLinks = document.querySelectorAll('.nav-links a');
  const sections = Array.from(navLinks)
    .map((link) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) {
        return null;
      }
      return document.querySelector(href);
    })
    .filter(Boolean);

  window.addEventListener('scroll', () => {
    const scrollPosition = window.scrollY + window.innerHeight / 3;
    sections.forEach((section, index) => {
      if (section.offsetTop <= scrollPosition && section.offsetTop + section.offsetHeight > scrollPosition) {
        navLinks.forEach((link) => link.classList.remove('active'));
        navLinks[index].classList.add('active');
      }
    });
  });
});