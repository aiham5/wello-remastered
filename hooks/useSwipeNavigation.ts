import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type UseSwipeNavigationParams = {
  activeIndex: number;
  maxIndex: number;
  setActiveIndex: (index: number) => void;
  enabled?: boolean;
};

export default function useSwipeNavigation({
  activeIndex,
  maxIndex,
  setActiveIndex,
  enabled = true,
}: UseSwipeNavigationParams) {
  const translateX = useSharedValue(0);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-10, 10])
        .failOffsetY([-8, 8])
        .onUpdate((event) => {
          "worklet";
          const swipingPastFirst = activeIndex <= 0 && event.translationX > 0;
          const swipingPastLast = activeIndex >= maxIndex && event.translationX < 0;
          const factor = swipingPastFirst || swipingPastLast ? 0.15 : 0.4;
          translateX.value = event.translationX * factor;
        })
        .onEnd((event) => {
          "worklet";
          if (event.translationX < -60 && activeIndex < maxIndex) {
            runOnJS(setActiveIndex)(activeIndex + 1);
            translateX.value = withTiming(0, {
              duration: 280,
              easing: Easing.out(Easing.cubic),
            });
            return;
          }
          if (event.translationX > 60 && activeIndex > 0) {
            runOnJS(setActiveIndex)(activeIndex - 1);
            translateX.value = withTiming(0, {
              duration: 280,
              easing: Easing.out(Easing.cubic),
            });
            return;
          }
          translateX.value = withTiming(0, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          });
        }),
    [activeIndex, enabled, maxIndex, setActiveIndex, translateX],
  );

  const animatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: translateX.value }],
    }),
    [translateX],
  );

  return {
    animatedStyle,
    gesture,
    translateX,
  };
}
