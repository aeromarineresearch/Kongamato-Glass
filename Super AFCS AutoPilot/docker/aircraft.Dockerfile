# aircraft-image — ONE Dockerfile, two targets (AAS code-parity principle).
#   --target sim    : amd64, runs against Gazebo/SITL on dev machines & CI
#   --target deploy : arm64 (JetPack L4T), runs on the Jetson in the airplane
# Same ROS2 packages, same behavior trees, same ONNX model. Only the base
# image and ONNX execution provider differ. See docs/SIM2REAL.md §1.

ARG BASE_SIM=ros:jazzy-ros-base
ARG BASE_DEPLOY=nvcr.io/nvidia/l4t-jetpack:r36.4.0

# ---------- shared stage: ROS2 workspace ----------
FROM ${BASE_SIM} AS ws-amd64
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ros-jazzy-mavros ros-jazzy-mavros-extras \
      python3-onnxruntime python3-opencv && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /ws
COPY autonomy_ws/src /ws/src
RUN . /opt/ros/jazzy/setup.sh && colcon build --symlink-install

FROM ${BASE_DEPLOY} AS ws-arm64
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ros-humble-mavros python3-opencv && \
    rm -rf /var/lib/apt/lists/*
# NOTE: JetPack images carry TensorRT; onnxruntime-gpu with the TensorRT
# execution provider is installed at first-boot provisioning (AAS pattern).
WORKDIR /ws
COPY autonomy_ws/src /ws/src
RUN . /opt/ros/humble/setup.sh && colcon build --symlink-install

FROM ws-amd64  AS sim
ENV AFCS_ENV=sim ONNX_PROVIDER=CUDAExecutionProvider
CMD ["bash", "-c", ". /ws/install/setup.bash && ros2 launch afcs_bringup sim.launch.py"]

FROM ws-arm64  AS deploy
ENV AFCS_ENV=deploy ONNX_PROVIDER=TensorrtExecutionProvider
CMD ["bash", "-c", ". /ws/install/setup.bash && ros2 launch afcs_bringup aircraft.launch.py"]
