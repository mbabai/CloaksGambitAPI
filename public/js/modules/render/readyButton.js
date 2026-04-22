import { renderButton } from '../ui/buttons.js';

export function renderReadyButton({
  root,
  boardLeft,
  boardTop,
  boardWidth,
  boardHeight,
  isVisible,
  isHighlighted = false,
  onClick
}) {
  const button = renderButton({
    id: 'setupReadyBtn',
    root,
    boardLeft,
    boardTop,
    boardWidth,
    boardHeight,
    visible: isVisible,
    label: 'Ready!',
    variant: 'primary',
    size: 'large',
    onClick
  });
  if (button) {
    button.classList.toggle('cg-ready-button--highlighted', Boolean(isHighlighted));
  }
  return button;
}


