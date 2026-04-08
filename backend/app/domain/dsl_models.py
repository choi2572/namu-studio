"""DSL v1 domain models."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class StateType(str, Enum):
    """State type enum."""

    SKILL = "Skill"
    CONDITION = "Condition"
    PARALLEL = "Parallel"
    WAIT = "Wait"
    PASS = "Pass"


class Operator(str, Enum):
    """Comparison operator."""

    EQ = "=="
    NE = "!="
    GT = ">"
    LT = "<"
    GE = ">="
    LE = "<="


class EventType(str, Enum):
    """Wait event type."""

    WEBHOOK = "webhook"
    ROS_TOPIC = "ros_topic"


@dataclass
class InputDefinition:
    """Input definition."""

    Type: str
    Value: Any
    Desc: str | None = None


@dataclass
class ConditionExpression:
    """Condition expression."""

    Variable: str
    Operator: Operator
    Value: Any


@dataclass
class ConditionBranch:
    """Condition branch (If)."""

    Condition: ConditionExpression
    Then: str


@dataclass
class WaitEvent:
    """Wait event definition."""

    Type: EventType
    Topic: str


@dataclass
class ParallelBranch:
    """Parallel branch definition."""

    StartAt: str
    States: dict[str, "State"]


@dataclass
class State:
    """Base state class."""

    Type: StateType
    Timeout: int | None = None
    Next: str | None = None
    End: bool | None = None

    def __post_init__(self):
        """Validate state."""
        if self.Next is not None and self.End is True:
            raise ValueError("Next and End are mutually exclusive")
        if self.Next is None and self.End is None:
            raise ValueError("State must have either Next or End")


@dataclass
class SkillState(State):
    """Skill state."""

    Skill: str
    Parameters: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        """Validate skill state."""
        super().__post_init__()
        if not self.Skill:
            raise ValueError("Skill state must have Skill field")


@dataclass
class ConditionState(State):
    """Condition state."""

    If: ConditionBranch
    Else: str

    def __post_init__(self):
        """Validate condition state."""
        super().__post_init__()
        if not self.If:
            raise ValueError("Condition state must have If field")
        if not self.Else:
            raise ValueError("Condition state must have Else field")


@dataclass
class ParallelState(State):
    """Parallel state."""

    Branches: list[ParallelBranch]

    def __post_init__(self):
        """Validate parallel state."""
        super().__post_init__()
        if not self.Branches or len(self.Branches) == 0:
            raise ValueError("Parallel state must have at least one branch")
        for branch in self.Branches:
            if not branch.StartAt:
                raise ValueError("Parallel branch must have StartAt")
            if not branch.States:
                raise ValueError("Parallel branch must have States")


@dataclass
class WaitState(State):
    """Wait state."""

    Event: WaitEvent
    Timeout: int  # Required for Wait

    def __post_init__(self):
        """Validate wait state."""
        super().__post_init__()
        if not self.Event:
            raise ValueError("Wait state must have Event field")
        if self.Timeout is None:
            raise ValueError("Wait state must have Timeout field")


@dataclass
class PassState(State):
    """Pass state."""

    pass


@dataclass
class WorkflowDSL:
    """Workflow DSL v1."""

    Inputs: dict[str, InputDefinition] | None = None
    StartAt: str = ""
    States: dict[str, State] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkflowDSL":
        """Parse DSL from dictionary."""
        inputs = None
        if "Inputs" in data:
            inputs = {k: InputDefinition(**v) if isinstance(v, dict) else v for k, v in data["Inputs"].items()}

        start_at = data.get("StartAt", "")
        states_dict = data.get("States", {})

        states = {}
        for state_name, state_data in states_dict.items():
            if not isinstance(state_data, dict):
                continue

            state_type_str = state_data.get("Type", "")
            state_type = StateType(state_type_str)

            if state_type == StateType.SKILL:
                state = SkillState(
                    Type=state_type,
                    Skill=state_data.get("Skill", ""),
                    Parameters=state_data.get("Parameters", {}),
                    Timeout=state_data.get("Timeout"),
                    Next=state_data.get("Next"),
                    End=state_data.get("End"),
                )
            elif state_type == StateType.CONDITION:
                if_data = state_data.get("If", {})
                condition_data = if_data.get("Condition", {})
                state = ConditionState(
                    Type=state_type,
                    If=ConditionBranch(
                        Condition=ConditionExpression(
                            Variable=condition_data.get("Variable", ""),
                            Operator=Operator(condition_data.get("Operator", "==")),
                            Value=condition_data.get("Value"),
                        ),
                        Then=if_data.get("Then", ""),
                    ),
                    Else=state_data.get("Else", ""),
                    Timeout=state_data.get("Timeout"),
                    Next=state_data.get("Next"),
                    End=state_data.get("End"),
                )
            elif state_type == StateType.PARALLEL:
                branches_data = state_data.get("Branches", [])
                branches = []
                for branch_data in branches_data:
                    branch_states = {}
                    for branch_state_name, branch_state_data in branch_data.get("States", {}).items():
                        branch_states[branch_state_name] = cls._parse_state(branch_state_data)
                    branches.append(
                        ParallelBranch(
                            StartAt=branch_data.get("StartAt", ""),
                            States=branch_states,
                        )
                    )
                state = ParallelState(
                    Type=state_type,
                    Branches=branches,
                    Timeout=state_data.get("Timeout"),
                    Next=state_data.get("Next"),
                    End=state_data.get("End"),
                )
            elif state_type == StateType.WAIT:
                event_data = state_data.get("Event", {})
                state = WaitState(
                    Type=state_type,
                    Event=WaitEvent(
                        Type=EventType(event_data.get("Type", "webhook")),
                        Topic=event_data.get("Topic", ""),
                    ),
                    Timeout=state_data.get("Timeout", 300),
                    Next=state_data.get("Next"),
                    End=state_data.get("End"),
                )
            elif state_type == StateType.PASS:
                state = PassState(
                    Type=state_type,
                    Timeout=state_data.get("Timeout"),
                    Next=state_data.get("Next"),
                    End=state_data.get("End"),
                )
            else:
                continue

            states[state_name] = state

        return cls(
            Inputs=inputs,
            StartAt=start_at,
            States=states,
        )

    @staticmethod
    def _parse_state(state_data: dict[str, Any]) -> State:
        """Parse a single state from dict (helper for nested states)."""
        state_type_str = state_data.get("Type", "")
        state_type = StateType(state_type_str)

        if state_type == StateType.SKILL:
            return SkillState(
                Type=state_type,
                Skill=state_data.get("Skill", ""),
                Parameters=state_data.get("Parameters", {}),
                Timeout=state_data.get("Timeout"),
                Next=state_data.get("Next"),
                End=state_data.get("End"),
            )
        elif state_type == StateType.PASS:
            return PassState(
                Type=state_type,
                Timeout=state_data.get("Timeout"),
                Next=state_data.get("Next"),
                End=state_data.get("End"),
            )
        else:
            # For nested states in Parallel, only Skill and Pass are allowed in M1
            raise ValueError(f"Unsupported state type in Parallel branch: {state_type}")

    def to_dict(self) -> dict[str, Any]:
        """Convert DSL to dictionary."""
        result = {
            "StartAt": self.StartAt,
            "States": {},
        }

        if self.Inputs:
            result["Inputs"] = {
                k: {
                    "Type": v.Type,
                    "Value": v.Value,
                    **({"Desc": v.Desc} if v.Desc else {}),
                }
                for k, v in self.Inputs.items()
            }

        for state_name, state in self.States.items():
            state_dict = {
                "Type": state.Type.value,
            }

            if state.Timeout is not None:
                state_dict["Timeout"] = state.Timeout
            if state.Next is not None:
                state_dict["Next"] = state.Next
            if state.End is not None:
                state_dict["End"] = state.End

            if isinstance(state, SkillState):
                state_dict["Skill"] = state.Skill
                if state.Parameters:
                    state_dict["Parameters"] = state.Parameters
            elif isinstance(state, ConditionState):
                state_dict["If"] = {
                    "Condition": {
                        "Variable": state.If.Condition.Variable,
                        "Operator": state.If.Condition.Operator.value,
                        "Value": state.If.Condition.Value,
                    },
                    "Then": state.If.Then,
                }
                state_dict["Else"] = state.Else
            elif isinstance(state, ParallelState):
                state_dict["Branches"] = [
                    {
                        "StartAt": branch.StartAt,
                        "States": {name: self._state_to_dict(s) for name, s in branch.States.items()},
                    }
                    for branch in state.Branches
                ]
            elif isinstance(state, WaitState):
                state_dict["Event"] = {
                    "Type": state.Event.Type.value,
                    "Topic": state.Event.Topic,
                }
                state_dict["Timeout"] = state.Timeout

            result["States"][state_name] = state_dict

        return result

    @staticmethod
    def _state_to_dict(state: State) -> dict[str, Any]:
        """Convert a state to dictionary (helper for nested states)."""
        state_dict = {
            "Type": state.Type.value,
        }

        if state.Timeout is not None:
            state_dict["Timeout"] = state.Timeout
        if state.Next is not None:
            state_dict["Next"] = state.Next
        if state.End is not None:
            state_dict["End"] = state.End

        if isinstance(state, SkillState):
            state_dict["Skill"] = state.Skill
            if state.Parameters:
                state_dict["Parameters"] = state.Parameters

        return state_dict
