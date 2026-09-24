<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { ButtonHTMLAttributes, HTMLAttributes } from "vue";
import type { ButtonVariants } from ".";
import { Primitive } from "reka-ui";
import { cn } from "@/lib/common/utils";
import { buttonVariants } from ".";

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  type?: ButtonHTMLAttributes["type"];
  class?: HTMLAttributes["class"];
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  // Native buttons default to type="submit" inside forms, so an untyped Button placed in a
  // dialog body would steal Enter presses (and stray clicks) from the real submit control.
  // Opt out explicitly: everything is type="button" unless it opts in with type="submit".
  type: "button",
});
</script>

<template>
  <Primitive data-slot="button" :data-variant="variant" :data-size="size" :as="as" :as-child="asChild" :type="type" :class="cn(buttonVariants({ variant, size }), props.class)">
    <slot />
  </Primitive>
</template>
