import { describe,it,expect } from "vitest";
import { treeValue,monotoneProbabilities,predict,modelStatus } from "@/lib/predictions/inference";
import { featureNames } from "@/lib/predictions/features";
describe("Exported model contract",()=>{
  it("uses stable ordered features",()=>{expect(featureNames.length).toBe(14);expect(featureNames[0]).toBe("origin_code");expect(featureNames.at(-1)).toBe("cloud_cover_pct");});
  it("evaluates exported numerical tree branches",()=>{const tree={split_feature:0,threshold:2,decision_type:"<=",default_left:true,left_child:{leaf_value:-0.2},right_child:{leaf_value:0.4}};expect(treeValue(tree,[1])).toBe(-0.2);expect(treeValue(tree,[3])).toBe(0.4);expect(treeValue(tree,[NaN])).toBe(-0.2);});
  it("enforces monotonic thresholds and probability ranges",()=>{expect(monotoneProbabilities([0.2,0.7,0.3])).toEqual([0.2,0.2,0.2]);expect(monotoneProbabilities([1.2,0.4,-0.2])).toEqual([1,0.4,0]);});
  it("does not produce probabilities without a model",async()=>{const status=await modelStatus();if(!status.available)await expect(predict({})).rejects.toMatchObject({code:"MODEL_UNAVAILABLE"});});
});
