import { renderButton } from '../ui/buttons.js';

export function renderReadyButton({
  root,
  boardLeft,
  boardTop,
  boardWidth,
  boardHeight,
  isVisible,
  onClick
}) {
  return renderButton({
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
}


