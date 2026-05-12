import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Template categories per business type
const categoryTemplates: Record<
  string,
  { name: string; nameBn: string; description: string }[]
> = {
  retail: [
    {
      name: 'Rice & Grains',
      nameBn: 'চাল ও শস্য',
      description: 'Rice, wheat, and other grains',
    },
    {
      name: 'Cooking Oil',
      nameBn: 'রান্নার তেল',
      description: 'Mustard oil, soybean oil, sunflower oil',
    },
    {
      name: 'Spices',
      nameBn: 'মসলা',
      description: 'Turmeric, cumin, chili, coriander',
    },
    {
      name: 'Pulses & Lentils',
      nameBn: 'ডাল',
      description: 'Red lentils, chickpeas, mung beans',
    },
    {
      name: 'Sugar & Sweeteners',
      nameBn: 'চিনি ও মিষ্টি',
      description: 'Sugar, jaggery, honey',
    },
    {
      name: 'Flour & Atta',
      nameBn: 'আটা ও ময়দা',
      description: 'Wheat flour, rice flour, semolina',
    },
    { name: 'Salt', nameBn: 'লবণ', description: 'Table salt, sea salt' },
    {
      name: 'Biscuits & Cookies',
      nameBn: 'বিস্কুট',
      description: 'Packaged biscuits and cookies',
    },
    {
      name: 'Snacks',
      nameBn: 'স্ন্যাকস',
      description: 'Chips, chanachur, nimki',
    },
    {
      name: 'Tea & Coffee',
      nameBn: 'চা ও কফি',
      description: 'Tea leaves, coffee powder',
    },
    {
      name: 'Beverages',
      nameBn: 'পানীয়',
      description: 'Soft drinks, juice, water',
    },
    {
      name: 'Dairy Products',
      nameBn: 'দুগ্ধজাত পণ্য',
      description: 'Milk, curd, butter, cheese',
    },
    {
      name: 'Frozen Foods',
      nameBn: 'হিমায়িত খাবার',
      description: 'Frozen vegetables, fish, meat',
    },
  ],
  grocery: [
    {
      name: 'Fresh Vegetables',
      nameBn: 'তাজা সবজি',
      description: 'Seasonal vegetables',
    },
    { name: 'Fresh Fruits', nameBn: 'তাজা ফল', description: 'Seasonal fruits' },
    {
      name: 'Rice & Grains',
      nameBn: 'চাল ও শস্য',
      description: 'Rice, wheat, and other grains',
    },
    {
      name: 'Pulses & Lentils',
      nameBn: 'ডাল',
      description: 'Red lentils, chickpeas, mung beans',
    },
    {
      name: 'Cooking Oil',
      nameBn: 'রান্নার তেল',
      description: 'Mustard oil, soybean oil',
    },
    {
      name: 'Spices',
      nameBn: 'মসলা',
      description: 'Turmeric, cumin, chili, coriander',
    },
    {
      name: 'Dairy & Eggs',
      nameBn: 'দুধ ও ডিম',
      description: 'Milk, eggs, butter',
    },
    {
      name: 'Fish & Meat',
      nameBn: 'মাছ ও মাংস',
      description: 'Fresh and frozen fish, poultry, beef',
    },
    {
      name: 'Packaged Foods',
      nameBn: 'প্যাকেটজাত খাবার',
      description: 'Noodles, canned goods, snacks',
    },
  ],
  pharmacy: [
    {
      name: 'Prescription Drugs',
      nameBn: 'প্রেসক্রিপশন ওষুধ',
      description: 'Prescription-only medications',
    },
    {
      name: 'OTC Medicines',
      nameBn: 'ওটিসি ওষুধ',
      description: 'Over-the-counter medicines',
    },
    {
      name: 'Vitamins & Supplements',
      nameBn: 'ভিটামিন ও সাপ্লিমেন্ট',
      description: 'Vitamins, minerals, supplements',
    },
    {
      name: 'Medical Devices',
      nameBn: 'মেডিকেল ডিভাইস',
      description: 'Thermometers, BP machines, glucometers',
    },
    {
      name: 'Baby Care',
      nameBn: 'শিশু যত্ন',
      description: 'Baby food, diapers, creams',
    },
    {
      name: 'Personal Care',
      nameBn: 'ব্যক্তিগত যত্ন',
      description: 'Soaps, shampoos, skincare',
    },
    {
      name: 'First Aid',
      nameBn: 'প্রাথমিক চিকিৎসা',
      description: 'Bandages, antiseptics, gauze',
    },
  ],
  wholesale: [
    {
      name: 'Rice & Grains',
      nameBn: 'চাল ও শস্য',
      description: 'Bulk rice, wheat, and grains',
    },
    {
      name: 'Cooking Oil',
      nameBn: 'রান্নার তেল',
      description: 'Bulk oil — mustard, soybean, sunflower',
    },
    {
      name: 'Sugar & Salt',
      nameBn: 'চিনি ও লবণ',
      description: 'Bulk sugar and salt',
    },
    { name: 'Pulses', nameBn: 'ডাল', description: 'Bulk lentils and pulses' },
    {
      name: 'Flour',
      nameBn: 'আটা ও ময়দা',
      description: 'Bulk flour and atta',
    },
    { name: 'Spices', nameBn: 'মসলা', description: 'Bulk spices' },
    {
      name: 'Packaged Goods',
      nameBn: 'প্যাকেটজাত পণ্য',
      description: 'Biscuits, noodles, beverages (carton)',
    },
  ],
  electronics: [
    {
      name: 'Mobile Phones',
      nameBn: 'মোবাইল ফোন',
      description: 'Smartphones and feature phones',
    },
    {
      name: 'Accessories',
      nameBn: 'আনুষাঙ্গিক',
      description: 'Chargers, cables, cases',
    },
    {
      name: 'TVs & Displays',
      nameBn: 'টিভি ও ডিসপ্লে',
      description: 'Televisions and monitors',
    },
    {
      name: 'Audio',
      nameBn: 'অডিও',
      description: 'Speakers, headphones, earbuds',
    },
    {
      name: 'Home Appliances',
      nameBn: 'গৃহস্থালি যন্ত্রপাতি',
      description: 'Fans, irons, rice cookers',
    },
    {
      name: 'Computers',
      nameBn: 'কম্পিউটার',
      description: 'Laptops, desktops, tablets',
    },
  ],
  fashion: [
    {
      name: "Men's Clothing",
      nameBn: 'পুরুষের পোশাক',
      description: 'Shirts, pants, kurta',
    },
    {
      name: "Women's Clothing",
      nameBn: 'মহিলার পোশাক',
      description: 'Saree, salwar kameez, tops',
    },
    {
      name: "Kids' Clothing",
      nameBn: 'শিশুর পোশাক',
      description: 'Boys and girls clothing',
    },
    { name: 'Footwear', nameBn: 'জুতা', description: 'Sandals, shoes, boots' },
    {
      name: 'Bags & Luggage',
      nameBn: 'ব্যাগ',
      description: 'Handbags, backpacks, travel bags',
    },
    {
      name: 'Accessories',
      nameBn: 'আনুষাঙ্গিক',
      description: 'Belts, wallets, jewelry',
    },
  ],
  restaurant: [
    {
      name: 'Raw Ingredients',
      nameBn: 'কাঁচামাল',
      description: 'Vegetables, meat, fish',
    },
    {
      name: 'Spices & Condiments',
      nameBn: 'মসলা ও কন্ডিমেন্ট',
      description: 'Spices, sauces, oils',
    },
    {
      name: 'Beverages',
      nameBn: 'পানীয়',
      description: 'Drinks served to customers',
    },
    {
      name: 'Packaging',
      nameBn: 'প্যাকেজিং',
      description: 'Takeaway boxes, bags, cutlery',
    },
    {
      name: 'Dry Goods',
      nameBn: 'শুকনো মাল',
      description: 'Rice, flour, lentils, oil',
    },
  ],
};
const DEFAULT_CATEGORIES = [
  { name: 'Rent', nameBn: 'ভাড়া', icon: 'home', color: '#4F46E5' },
  { name: 'Utilities', nameBn: 'ইউটিলিটি', icon: 'zap', color: '#F59E0B' },
  { name: 'Salaries', nameBn: 'বেতন', icon: 'users', color: '#10B981' },
  { name: 'Supplies', nameBn: 'সাপ্লাই', icon: 'package', color: '#6366F1' },
  { name: 'Transport', nameBn: 'পরিবহন', icon: 'truck', color: '#EC4899' },
  {
    name: 'Marketing',
    nameBn: 'মার্কেটিং',
    icon: 'megaphone',
    color: '#8B5CF6',
  },
  {
    name: 'Maintenance',
    nameBn: 'রক্ষণাবেক্ষণ',
    icon: 'tool',
    color: '#14B8A6',
  },
  {
    name: 'Other',
    nameBn: 'অন্যান্য',
    icon: 'more-horizontal',
    color: '#6B7280',
  },
];
// ─── Business Types ───────────────────────────────────────────────────────────
const businessTypes = [
  { value: 'retail', labelEn: 'Retail', labelBn: 'খুচরা' },
  { value: 'wholesale', labelEn: 'Wholesale', labelBn: 'থোক' },
  { value: 'pharmacy', labelEn: 'Pharmacy', labelBn: 'ফার্মেসি' },
  { value: 'grocery', labelEn: 'Grocery', labelBn: 'মুদির দোকান' },
  { value: 'electronics', labelEn: 'Electronics', labelBn: 'ইলেকট্রনিক্স' },
  { value: 'fashion', labelEn: 'Fashion', labelBn: 'ফ্যাশন' },
  { value: 'restaurant', labelEn: 'Restaurant', labelBn: 'রেস্তোরাঁ' },
  { value: 'construction', labelEn: 'Construction', labelBn: 'নির্মাণ' },
  { value: 'education', labelEn: 'Education', labelBn: 'শিক্ষা' },
  { value: 'healthcare', labelEn: 'Healthcare', labelBn: 'স্বাস্থ্যসেবা' },
  { value: 'logistics', labelEn: 'Logistics', labelBn: 'পরিবহন' },
  { value: 'beauty', labelEn: 'Beauty', labelBn: 'সৌন্দর্য' },
  { value: 'automobile', labelEn: 'Automobile', labelBn: 'অটোমোবাইল' },
  { value: 'sports', labelEn: 'Sports', labelBn: 'খেলাধুলা' },
  { value: 'stationery', labelEn: 'Stationery', labelBn: 'স্টেশনারি' },
];

async function main() {
  // 1. Seed business types
  for (const type of businessTypes) {
    await prisma.businessType.upsert({
      where: { value: type.value },
      update: {},
      create: type,
    });
  }
  console.log('Seeded business types ✅');
  // 3. Seed default expense categories
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: {
        businessId_name: {
          businessId: 'null',
          name: category.name,
        },
      },
      update: {},
      create: {
        ...category,
        businessId: null, // global category
        isDefault: true,
      },
    });
  }

  console.log(`Seeded ${DEFAULT_CATEGORIES.length} expense categories ✅`);
  // 2. Seed template categories scoped to each business type
  for (const [typeValue, categories] of Object.entries(categoryTemplates)) {
    const businessType = await prisma.businessType.findUnique({
      where: { value: typeValue },
    });

    if (!businessType) {
      console.warn(`Business type "${typeValue}" not found — skipping.`);
      continue;
    }

    for (const category of categories) {
      await prisma.category.upsert({
        where: {
          businessTypeId_name: {
            // @@unique([businessTypeId, name])
            businessTypeId: businessType.id,
            name: category.name,
          },
        },
        update: {},
        create: {
          ...category,
          businessTypeId: businessType.id,
          isTemplate: true,
        },
      });
    }

    console.log(`Seeded ${categories.length} categories for "${typeValue}" ✅`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
