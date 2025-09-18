import { renderButton } from '../ui/buttons.js';

export function renderGameButton(options) {
  if (!options || typeof options !== 'object') return null;
  const {
    text,
    label = text,
    background,
    variant,
    size = 'auto',
    sizeBasis,
    ...rest
  } = options;

  return renderButton({
    ...rest,
    label,
    background,
    variant,
    size,
    sizeBasis
  });
}


