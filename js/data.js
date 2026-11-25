/* Sample wardrobe for the prototype: three woven bags, each holding a pile.
   pattern.kind maps to a fabric generator in garments.js. */
window.RUMMAGE_DATA = {
  bags: [
    {
      id: 'everyday',
      name: 'Everyday',
      blurb: 'tees, shirts, denim, dresses',
      interior: '#172038',
      thread: '#D8457F',
      weave: [
        ['#2F62C6', 16], ['#F3EFE4', 2], ['#2F62C6', 8], ['#E2B13A', 6],
        ['#D8457F', 4], ['#E2B13A', 6], ['#2F62C6', 10], ['#F3EFE4', 2]
      ],
      items: [
        { id: 'e-breton', name: 'Breton long sleeve', type: 'longsleeve', pattern: { kind: 'stripe', colors: ['#F2EDE1', '#22305C'], size: 8, ratio: 0.38 }, fabric: 'Cotton', size: 'S' },
        { id: 'e-jeans', name: 'Light-wash jeans', type: 'trousers', pattern: { kind: 'denim', colors: ['#7096C6', '#2B4A78'] }, fabric: 'Denim', size: '32W 30L' },
        { id: 'e-red-tee', name: 'Tomato tee', type: 'tee', pattern: { kind: 'solid', colors: ['#D9533B'] }, fabric: 'Cotton jersey', size: 'M' },
        { id: 'e-white-tee', name: 'Plain white tee', type: 'tee', pattern: { kind: 'solid', colors: ['#F2F1EC'] }, fabric: 'Cotton jersey', size: 'M' },
        { id: 'e-black-tee', name: 'Black crew tee', type: 'tee', pattern: { kind: 'solid', colors: ['#1F1F24'] }, fabric: 'Cotton', size: 'L' },
        { id: 'e-hoodie', name: 'Grey hoodie', type: 'hoodie', pattern: { kind: 'solid', colors: ['#A9A8A3'] }, fabric: 'Brushed fleece', size: 'L' },
        { id: 'e-black-jeans', name: 'Black skinny jeans', type: 'trousers', pattern: { kind: 'denim', colors: ['#2A2B31', '#000000'] }, fabric: 'Stretch denim', size: '30W 32L' },
        { id: 'e-shorts', name: 'Khaki shorts', type: 'shorts', pattern: { kind: 'solid', colors: ['#C8B385'] }, fabric: 'Cotton twill', size: 'M' },
        { id: 'e-jersey', name: 'Green football jersey', type: 'tee', pattern: { kind: 'stripe', colors: ['#1E8B4E', '#F4F4F0'], size: 14, ratio: 0.3, rot: 90 }, fabric: 'Poly mesh', size: 'M' },
        { id: 'e-socks', name: 'Striped sports socks', type: 'socks', pattern: { kind: 'stripe', colors: ['#F4F3EF', '#D23A43'], size: 9, ratio: 0.25 }, fabric: 'Cotton', size: 'EU 39–42' },
        { id: 'e-gingham', name: 'Gingham shirt', type: 'longsleeve', pattern: { kind: 'gingham', colors: ['#F5F5F2', '#3E64B5'], size: 6 }, fabric: 'Poplin', size: 'M' },
        { id: 'e-joggers', name: 'Charcoal joggers', type: 'joggers', pattern: { kind: 'solid', colors: ['#3A3B40'] }, fabric: 'Fleece', size: 'L' },
        { id: 'e-mustard-socks', name: 'Mustard socks', type: 'socks', pattern: { kind: 'solid', colors: ['#D8A531'] }, fabric: 'Wool blend', size: 'EU 39–42' }
      ]
    },
    {
      id: 'fabrics',
      name: 'Fabrics',
      blurb: 'prints, lace, tie-dye',
      interior: '#14251C',
      thread: '#E8742A',
      weave: [
        ['#1F8A5B', 14], ['#F1E6C8', 3], ['#1F8A5B', 6], ['#E8742A', 7],
        ['#1D1D1D', 3], ['#E8742A', 7], ['#1F8A5B', 10], ['#F1E6C8', 2]
      ],
      items: [
        { id: 'f-kente', name: 'Kente stole', type: 'scarf', pattern: { kind: 'kente', colors: ['#E2B12C', '#1E7A43', '#C8312F', '#151515'] }, fabric: 'Woven strip cloth', size: '1.8 m' },
        { id: 'f-floral', name: 'Yellow floral print', type: 'fabric', pattern: { kind: 'floral', colors: ['#E8C531', '#C2304B', '#2B2A6B', '#2C7A3F'] }, fabric: 'Cotton wax print', size: '6 yards' },
        { id: 'f-adire', name: 'Indigo adire', type: 'fabric', pattern: { kind: 'adire', colors: ['#1F2C5C', '#DCE3F2'] }, fabric: 'Hand-dyed cotton', size: '2 yards' },
        { id: 'f-green-wax', name: 'Green Ankara wax print', type: 'fabric', pattern: { kind: 'wax', colors: ['#1F7A46', '#F2C230', '#0E2C4F', '#E9E2CF'] }, fabric: 'Cotton wax print', size: '6 yards' },
        { id: 'f-maroon', name: 'Maroon cotton', type: 'fabric', pattern: { kind: 'solid', colors: ['#7B1E3C'] }, fabric: 'Plain cotton', size: '2 yards' },
        { id: 'f-olive-sequin', name: 'Olive sequin lace', type: 'fabric', pattern: { kind: 'sequin', colors: ['#4E5326', '#D8B84A'] }, fabric: 'Sequinned net lace', size: '5 yards' },
        { id: 'f-cord-lace', name: 'Cream cord lace', type: 'fabric', pattern: { kind: 'lace', colors: ['#EFE6D2', '#B3A27F'] }, fabric: 'Cord lace', size: '5 yards' },
        { id: 'f-blue-wax', name: 'Blue and orange Ankara', type: 'fabric', pattern: { kind: 'leaf', colors: ['#E46A2B', '#1D3E8C', '#F4D9A8'] }, fabric: 'Cotton wax print', size: '6 yards' },
        { id: 'f-gele', name: 'Gold aso-oke gele', type: 'scarf', pattern: { kind: 'aso', colors: ['#C79A3C', '#F5DFA0', '#8E5B22'] }, fabric: 'Aso-oke', size: 'One head-tie' },
        { id: 'f-mud', name: 'Mud cloth', type: 'fabric', pattern: { kind: 'mud', colors: ['#1C1A17', '#EDE6D6'] }, fabric: 'Bògòlanfini cotton', size: '2 yards' },
        { id: 'f-teal-wrap', name: 'Teal headwrap', type: 'scarf', pattern: { kind: 'wax', colors: ['#167A7A', '#F1B6C8', '#F6F2E6', '#0E3B3B'] }, fabric: 'Cotton wax print', size: '2 m' },
        { id: 'f-chiffon', name: 'White chiffon', type: 'fabric', pattern: { kind: 'solid', colors: ['#F4F1F4'] }, fabric: 'Chiffon', size: '3 yards' }
      ]
    },
    {
      id: 'outerwear',
      name: 'Outerwear',
      blurb: 'jackets, boots, sneakers',
      interior: '#21182E',
      thread: '#1C9C9A',
      weave: [
        ['#6B3FA0', 14], ['#F2EEF6', 2], ['#6B3FA0', 6], ['#1C9C9A', 7],
        ['#E0569A', 3], ['#1C9C9A', 7], ['#6B3FA0', 10], ['#F2EEF6', 2]
      ],
      items: [
        { id: 'o-ankara-dress', name: 'Ankara midi dress', type: 'dress', pattern: { kind: 'wax', colors: ['#C2304B', '#F1B731', '#1D2A5A', '#F3EBDD'] }, fabric: 'Cotton wax print', size: 'UK 12' },
        { id: 'o-kaftan', name: 'Embroidered kaftan', type: 'kaftan', pattern: { kind: 'solid', colors: ['#F1EEE6'] }, trim: '#C9A13B', fabric: 'Cotton voile', size: 'One size' },
        { id: 'o-pleated', name: 'Emerald pleated skirt', type: 'skirt', pattern: { kind: 'solid', colors: ['#1C6B53'] }, fabric: 'Crepe', size: 'UK 12' },
        { id: 'o-black-slip', name: 'Black slip dress', type: 'dress', pattern: { kind: 'solid', colors: ['#16161A'] }, fabric: 'Satin', size: 'UK 10' },
        { id: 'o-boubou', name: 'Indigo boubou', type: 'kaftan', pattern: { kind: 'adire', colors: ['#233163', '#E3E8F5'] }, trim: '#E3E8F5', fabric: 'Hand-dyed cotton', size: 'One size' },
        { id: 'o-kente-skirt', name: 'Kente pencil skirt', type: 'skirt', pattern: { kind: 'kente', colors: ['#E2B12C', '#1E7A43', '#C8312F', '#151515'] }, fabric: 'Woven strip cloth', size: 'UK 10' },
        { id: 'o-red-dress', name: 'Red occasion dress', type: 'dress', pattern: { kind: 'solid', colors: ['#B4232F'] }, fabric: 'Crepe', size: 'UK 12' },
        { id: 'o-lace-blouse', name: 'Lace blouse', type: 'tee', pattern: { kind: 'lace', colors: ['#EFE7D6', '#B9A27C'] }, fabric: 'Cord lace', size: 'M' },
        { id: 'o-wide-leg', name: 'Cream wide-leg trousers', type: 'trousers', pattern: { kind: 'solid', colors: ['#E6DCCB'] }, fabric: 'Linen', size: 'UK 12' },
        { id: 'o-rose-gele', name: 'Rose-gold gele', type: 'scarf', pattern: { kind: 'aso', colors: ['#C9877A', '#F6D5C6', '#8A4E45'] }, fabric: 'Aso-oke', size: 'One head-tie' },
        { id: 'o-agbada', name: 'Sky-blue agbada', type: 'kaftan', pattern: { kind: 'solid', colors: ['#8DB8DE'] }, trim: '#F4F6FA', fabric: 'Brocade', size: 'XL' },
        { id: 'o-wrap-skirt', name: 'Indigo floral wrap skirt', type: 'skirt', pattern: { kind: 'floral', colors: ['#2C2A6B', '#F1B731', '#E4573A', '#2C7A3F'] }, fabric: 'Cotton wax print', size: 'One size' }
      ]
    }
  ]
};
