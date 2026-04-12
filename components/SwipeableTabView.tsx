import React from "react";
import { StyleSheet } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import useSwipeNavigation from "../hooks/useSwipeNavigation";

type SwipeableTabViewProps = {
  tabs: Array<string>;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  children: React.ReactNode;
  enabled?: boolean;
};

export default function SwipeableTabView({
  tabs,
  activeIndex,
  setActiveIndex,
  children,
  enabled = true,
}: SwipeableTabViewProps) {
  const { animatedStyle, gesture } = useSwipeNavigation({
    activeIndex,
    maxIndex: Math.max(0, tabs.length - 1),
    setActiveIndex,
    enabled: enabled && tabs.length > 1,
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.container, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
