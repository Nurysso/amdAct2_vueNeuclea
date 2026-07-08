from models import Product

PRODUCTS: list[Product] = [
    # ── Electronics ────────────────────────────────────────────────────────────
    Product(
        id=1,
        slug="arc-pro-headphones",
        name="Arc Pro Noise-Cancelling Headphones",
        price=289.99,
        category="Electronics",
        image_url="https://picsum.photos/seed/prod-1/600/400",
        rating=4.8,
        stock=42,
        tags=["audio", "wireless", "anc", "premium"],
        description=(
            "Industry-leading 40dB active noise cancellation in an over-ear form factor "
            "engineered for marathon work sessions. Dual-driver acoustics deliver reference-flat "
            "response from 4Hz to 40kHz. 38-hour battery life with USB-C fast charge — "
            "10 minutes gives you 3 hours."
        ),
    ),
    Product(
        id=2,
        slug="vertex-mech-keyboard",
        name="Vertex 75% Mechanical Keyboard",
        price=179.00,
        category="Electronics",
        image_url="https://picsum.photos/seed/prod-2/600/400",
        rating=4.9,
        stock=18,
        tags=["keyboard", "mechanical", "tactile", "rgb"],
        description=(
            "Hot-swap PCB with pre-lubed Gateron G Pro tactile switches and a gasket-mounted "
            "plate for that satisfying thock that stops passers-by. South-facing per-key RGB, "
            "QMK/VIA compatible. CNC-machined aluminium top case ships in Space Grey or Midnight."
        ),
    ),
    Product(
        id=3,
        slug="nexus-usbc-hub",
        name="Nexus 12-in-1 USB-C Hub",
        price=89.95,
        category="Electronics",
        image_url="https://picsum.photos/seed/prod-3/600/400",
        rating=4.6,
        stock=97,
        tags=["hub", "usb-c", "thunderbolt", "connectivity"],
        description=(
            "Single-cable docking in a CNC aluminium shell that stays cool under sustained load. "
            "Dual 4K HDMI outputs, 100W passthrough PD, 2.5GbE Ethernet, SD/microSD UHS-II slots, "
            "and three USB-A 3.2 Gen 2 ports. Plug-and-play on macOS, Windows, and ChromeOS."
        ),
    ),
    Product(
        id=4,
        slug="pulse-wireless-charger",
        name="Pulse 3-in-1 Wireless Charger",
        price=64.99,
        category="Electronics",
        image_url="https://picsum.photos/seed/prod-4/600/400",
        rating=4.5,
        stock=61,
        tags=["wireless", "charging", "magsafe", "qi2"],
        description=(
            "Simultaneous Qi2 charging for phone, earbuds, and watch on a matte-textured "
            "seamless puck — no coil hunting, no misalignment frustration. 15W peak output "
            "on certified Qi2 devices. Braided USB-C cable and 30W GaN adapter included."
        ),
    ),
    Product(
        id=5,
        slug="clarity-4k-webcam",
        name="Clarity 4K Studio Webcam",
        price=149.00,
        category="Electronics",
        image_url="https://picsum.photos/seed/prod-5/600/400",
        rating=4.7,
        stock=33,
        tags=["webcam", "4k", "streaming", "video"],
        description=(
            "Sony 1/1.8\" sensor with an f/2.0 aperture for genuine low-light performance "
            "without artificial brightening. AI-powered face framing keeps you centred as you "
            "move. 4K/30 or 1080p/60, HDR, and dual beamforming mics with hardware mute LED."
        ),
    ),
    # ── Clothing ───────────────────────────────────────────────────────────────
    Product(
        id=6,
        slug="alpine-merino-hoodie",
        name="Alpine Merino Wool Hoodie",
        price=198.00,
        category="Clothing",
        image_url="https://picsum.photos/seed/prod-6/600/400",
        rating=4.9,
        stock=55,
        tags=["merino", "wool", "hoodie", "sustainable"],
        description=(
            "ZQ-certified 18.5-micron merino knit at 280gsm — warm enough for a draughty "
            "office, breathable enough for a fast commute. Naturally odour-resistant and "
            "machine washable. Raglan cut for unrestricted shoulder movement; ribbed cuffs "
            "and hem hold shape through 200+ washes."
        ),
    ),
    Product(
        id=7,
        slug="strider-running-shoes",
        name="Strider Carbon-Plate Running Shoes",
        price=239.99,
        category="Clothing",
        image_url="https://picsum.photos/seed/prod-7/600/400",
        rating=4.7,
        stock=24,
        tags=["running", "carbon", "shoes", "performance"],
        description=(
            "Full-length carbon fibre plate sits inside a 38mm dual-density foam stack "
            "that stores and releases energy through the gait cycle. A 200g race shoe "
            "with enough stack for training miles. Upper is engineered mesh with a "
            "one-piece heel counter for lock-in without a hot spot."
        ),
    ),
    Product(
        id=8,
        slug="horween-watch-strap",
        name="Horween Shell Cordovan Watch Strap",
        price=85.00,
        category="Clothing",
        image_url="https://picsum.photos/seed/prod-8/600/400",
        rating=4.8,
        stock=40,
        tags=["watch", "leather", "horween", "strap"],
        description=(
            "Hand-cut from Horween's Chicago tannery — the same shell cordovan that "
            "goes into $800 dress shoes. Develops a mirror shine with use rather than "
            "wearing out. Available in 18, 20, and 22mm with a matching stitched edge "
            "and stainless quick-release spring bars."
        ),
    ),
    Product(
        id=9,
        slug="brushed-ribbed-beanie",
        name="Brushed Ribbed Merino Beanie",
        price=48.00,
        category="Clothing",
        image_url="https://picsum.photos/seed/prod-9/600/400",
        rating=4.6,
        stock=120,
        tags=["beanie", "merino", "winter", "hat"],
        description=(
            "Double-layered 100% merino rib knit sits exactly at the eyebrows without "
            "slipping — the shape holds because the yarn does, not because it's too tight. "
            "Garment-dyed in a palette of eight neutrals that don't fade to grey after three seasons."
        ),
    ),
    Product(
        id=10,
        slug="pro-compression-socks",
        name="Pro Compression Running Socks",
        price=28.00,
        category="Clothing",
        image_url="https://picsum.photos/seed/prod-10/600/400",
        rating=4.5,
        stock=200,
        tags=["socks", "compression", "running", "recovery"],
        description=(
            "15–20 mmHg graduated compression with anatomical left/right differentiation. "
            "Merino-blend forefoot cushioning absorbs impact; thin arch wraps hold the sock "
            "in place through a full marathon. Antimicrobial silver-ion yarn keeps odour "
            "in check on back-to-back training days."
        ),
    ),
    # ── Home & Garden ──────────────────────────────────────────────────────────
    Product(
        id=11,
        slug="ritual-pourover-kit",
        name="Ritual Pour-Over Coffee Kit",
        price=124.00,
        category="Home & Garden",
        image_url="https://picsum.photos/seed/prod-11/600/400",
        rating=4.9,
        stock=31,
        tags=["coffee", "pour-over", "specialty", "kit"],
        description=(
            "Borosilicate dripper, hand-blown server with volume markings, gooseneck kettle "
            "with temperature hold, and a stainless burr grinder — the complete ritual in one "
            "matte-white box. Kalita wave filters included for your first 60 brews. "
            "Everything is dishwasher safe except the grinder burrs."
        ),
    ),
    Product(
        id=12,
        slug="lodge-cast-iron-skillet",
        name="Lodge 12-inch Seasoned Cast Iron Skillet",
        price=54.99,
        category="Home & Garden",
        image_url="https://picsum.photos/seed/prod-12/600/400",
        rating=4.8,
        stock=88,
        tags=["cast-iron", "cookware", "skillet", "kitchen"],
        description=(
            "Foundry-seasoned with vegetable oil and ready to cook immediately — no break-in "
            "required. The 12-inch cooking surface sits flat on induction, gas, ceramic, and "
            "open fire. Dual pour spouts and a helper handle for safe two-handed manoeuvring "
            "when moving from stovetop to oven."
        ),
    ),
    Product(
        id=13,
        slug="beeswax-pillar-candles",
        name="Hand-Poured Beeswax Pillar Candles (Set of 3)",
        price=42.00,
        category="Home & Garden",
        image_url="https://picsum.photos/seed/prod-13/600/400",
        rating=4.7,
        stock=67,
        tags=["candles", "beeswax", "home", "scent"],
        description=(
            "100% pure beeswax from a single-origin UK apiary — naturally honey-scented "
            "without added fragrance. Burns 20% longer and 90% cleaner than paraffin equivalents. "
            "The three pillars graduate in height (10cm, 15cm, 20cm) and are designed to "
            "be grouped on a mantelpiece or dining table."
        ),
    ),
    Product(
        id=14,
        slug="sculptural-succulent-set",
        name="Sculptural Succulent Collection (Set of 6)",
        price=68.00,
        category="Home & Garden",
        image_url="https://picsum.photos/seed/prod-14/600/400",
        rating=4.6,
        stock=43,
        tags=["plants", "succulent", "indoor", "garden"],
        description=(
            "Six architecturally distinct species — Echeveria, Haworthia, Aloe, Sedum, "
            "Crassula, and Gasteria — curated for complementary form and colour. Shipped in "
            "custom matte-black ceramic vessels with drainage holes and a bag of gritty mix. "
            "Beginner-friendly; survives a two-week holiday without water."
        ),
    ),
    # ── Books ──────────────────────────────────────────────────────────────────
    Product(
        id=15,
        slug="pragmatic-programmer",
        name="The Pragmatic Programmer, 20th Anniversary Edition",
        price=49.95,
        category="Books",
        image_url="https://picsum.photos/seed/prod-15/600/400",
        rating=4.9,
        stock=200,
        tags=["programming", "software", "engineering", "classic"],
        description=(
            "Hunt and Thomas's foundational guide to software craftsmanship, fully revised "
            "for the modern stack. Every tip connects philosophy to practice — from DRY and "
            "orthogonality to ruthless testing and career ownership. The book that changed "
            "how a generation of engineers think about their work."
        ),
    ),
    Product(
        id=16,
        slug="deep-work",
        name="Deep Work: Rules for Focused Success",
        price=18.99,
        category="Books",
        image_url="https://picsum.photos/seed/prod-16/600/400",
        rating=4.7,
        stock=150,
        tags=["productivity", "focus", "work", "cal-newport"],
        description=(
            "Cal Newport's argument that the ability to focus without distraction is the "
            "rare skill that drives outsized professional results — and a practical roadmap "
            "for cultivating it. Four philosophies of deep work scheduling, an empirically "
            "grounded shutdown ritual, and a four-rules framework for building the habit."
        ),
    ),
    Product(
        id=17,
        slug="atomic-habits",
        name="Atomic Habits: Tiny Changes, Remarkable Results",
        price=22.50,
        category="Books",
        image_url="https://picsum.photos/seed/prod-17/600/400",
        rating=4.8,
        stock=300,
        tags=["habits", "productivity", "self-improvement", "james-clear"],
        description=(
            "James Clear's system for building good habits and breaking bad ones, grounded "
            "in identity-based change rather than willpower. The four-law habit loop — make it "
            "obvious, attractive, easy, and satisfying — provides a repeatable framework "
            "that compounds across every domain of life."
        ),
    ),
    Product(
        id=18,
        slug="dune",
        name="Dune (Collector's Edition)",
        price=34.99,
        category="Books",
        image_url="https://picsum.photos/seed/prod-18/600/400",
        rating=5.0,
        stock=75,
        tags=["sci-fi", "fiction", "classic", "frank-herbert"],
        description=(
            "Frank Herbert's planetary epic in a cloth-bound, foil-stamped collector's "
            "edition with newly commissioned interior illustrations. The best science-fiction "
            "novel ever written — politics, ecology, religion, and prophecy woven into a "
            "story that has never stopped being relevant since 1965."
        ),
    ),
]
