# Taste rules for pm-brief redesigns

These pages are a sales pitch. They must look art-directed, not generated.
Copy the spirit of the hand-built pages (The Dental Tree, Stoma kai Ygeia,
New Gen Accounting): one committed visual idea, real photography, real copy.

## Do
- Pick ONE palette and ONE type pairing and use them everywhere.
  Serif display + sans body, or a distinctive sans. Never default system UI.
- Use the supplied local photos as full-bleed hero / gallery images
  (`src="photo-01.jpg"`). `object-fit: cover`. Not tiny 58px icons.
- Write in the source language (Greek stays Greek).
- Services, names, hours, addresses: only from scraped content + the job fields.
- Sticky nav, obvious phone CTA, real Google Maps embed if we have an address.
- Generous spacing, large type, one accent, one paper color.

## Do not
- The navy-and-teal SaaS template. No `--acc:#0fb5a6` on `#123a4d`.
- "Quality service you can rely on", "Professional service", "Quality first",
  "Local & trusted", "Modern solutions", "Your trusted partner".
- Fake testimonials, star ratings, years of experience, invented doctors,
  invented prices, stock-photo people who are not in the supplied photos.
- Hotlinking their CDN. Only local `photo-XX.jpg` files sitting next to index.html.
- A page with no photography when local photos were supplied.
