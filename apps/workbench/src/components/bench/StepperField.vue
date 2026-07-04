<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    step?: number;
    display?: string;
  }>(),
  { step: 1 },
);

const emit = defineEmits<{ change: [value: number] }>();

function bump(dir: number) {
  emit('change', props.value + dir * props.step);
}
</script>

<template>
  <div class="stp">
    <div class="stp-body">
      <button type="button" @click="bump(-1)">-</button>
      <span class="stp-val">{{ display ?? value }}</span>
      <button type="button" @click="bump(1)">+</button>
    </div>
    <span class="stp-lbl">{{ label }}</span>
  </div>
</template>

<style scoped>
.stp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stp-body {
  display: flex;
  align-items: center;
  border: 1px solid var(--seam);
  background: var(--iron);
}

.stp-body button {
  border: none;
  box-shadow: none;
  padding: 3px 7px;
  font-size: 11px;
  background: transparent;
}

.stp-body button:hover {
  transform: none;
  color: var(--phosphor);
}

.stp-val {
  min-width: 26px;
  text-align: center;
  font-size: 11px;
  color: var(--phosphor-hot);
  padding: 0 2px;
}

.stp-lbl {
  font-size: 8px;
  letter-spacing: 0.18em;
  color: var(--faded);
  text-transform: uppercase;
}
</style>
