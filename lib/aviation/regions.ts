export const regions = {
  "british-isles": { name: "British Isles", bounds: [-11, 49, 2, 59] as [number,number,number,number], center: [-2.5,53] as [number,number], zoom: 5.1 },
  "benelux": { name: "Benelux", bounds: [2, 49, 8, 54] as [number,number,number,number], center: [4.5,51.5] as [number,number], zoom: 6.1 },
  "central-europe": { name: "Central Europe", bounds: [2,45,17,55] as [number,number,number,number], center: [6.5,50.5] as [number,number], zoom: 4.8 },
  "iberia": { name: "Iberian Peninsula", bounds: [-10,35,4,44] as [number,number,number,number], center: [-3,40] as [number,number], zoom: 5.2 },
  "northern-italy": { name: "Northern Italy", bounds: [6,42,15,48] as [number,number,number,number], center: [10.5,45] as [number,number], zoom: 5.8 },
  "scandinavia": { name: "Scandinavia", bounds: [5,54,26,64] as [number,number,number,number], center: [13,58.5] as [number,number], zoom: 4.9 }
};
export type RegionId = keyof typeof regions;
